/**
 * Copiar el prompt de n8n a `lib/gateway/sistema.ts`, sin escribirlo a mano.
 *
 *     node n8n/parches/sincronizar-prompt.mjs
 *
 * ============================================================
 * POR QUÉ ESTO EXISTE
 * ============================================================
 *
 * El prompt vive en dos lugares mientras convivan los dos caminos —n8n y el
 * gateway en TypeScript— y `sistema.test.ts` comprueba que sean el MISMO
 * texto, carácter por carácter. La comprobación está bien; lo que faltaba era
 * la forma de cumplirla.
 *
 * Hasta ahora, después de cada parche había que copiar el prompt a mano al
 * archivo, convirtiendo saltos de línea en `\n` y escapando comillas. Es
 * exactamente el trabajo que una persona hace mal una de cada cinco veces, y
 * cuando sale mal la prueba falla con un diff de 17 KB donde no se ve nada.
 *
 * Acá se extrae del workflow EXPORTADO —el que está corriendo— y se escribe
 * como literal de JavaScript con `JSON.stringify`, que es la misma función
 * que después lo lee. No hay forma de que difieran.
 *
 * Corre solo sobre archivos del repositorio: no toca n8n ni la base.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const WORKFLOW = path.join(RAIZ, "n8n", "workflows", "eos-conversational-gateway-rc1.json");
const SISTEMA = path.join(RAIZ, "lib", "gateway", "sistema.ts");

const flujo = JSON.parse(fs.readFileSync(WORKFLOW, "utf8"));
const http = flujo.nodes.find((n) => n.name === "HTTP Request");

if (!http) throw new Error("el gateway exportado no tiene el nodo HTTP Request");

/*
 * El prompt es el primer literal de plantilla del cuerpo: `text: ` seguido de
 * una comilla invertida, hasta la que cierra. La misma lectura que hace la
 * prueba, a propósito: si un día cambia la forma del nodo, las dos se enteran
 * juntas en vez de una decir que está todo bien.
 */
const cuerpo = http.parameters.jsonBody;
const inicio = cuerpo.indexOf("text: `");
if (inicio < 0) throw new Error("no se encontró el prompt dentro del nodo HTTP Request");

const desde = inicio + "text: `".length;
const fin = cuerpo.indexOf("`", desde);
const prompt = cuerpo.slice(desde, fin);

if (prompt.length < 1000) {
  // Un prompt cortado es la falla de la que este proyecto ya se acuerda: una
  // comilla invertida de más lo dejó en "El MONTO: mandá " y tiró el chat.
  throw new Error(`el prompt extraído tiene ${prompt.length} caracteres: está cortado`);
}

const ts = fs.readFileSync(SISTEMA, "utf8");
const marca = "export const PROMPT_SISTEMA = ";
const arranque = ts.indexOf(marca);

if (arranque < 0) throw new Error("no se encontró PROMPT_SISTEMA en sistema.ts");

const finLinea = ts.indexOf("\n", arranque);

// Sin el `\r`: en Windows el archivo tiene CRLF y la línea terminaría con un
// retorno de carro que no es parte del prompt. Sin recortarlo, el script se
// declararía "actualizado" en cada corrida sin cambiar nada.
const antes = ts.slice(arranque, finLinea).replace(/\r$/, "");
const despues = `${marca}${JSON.stringify(prompt)};`;

if (antes === despues) {
  console.log("sistema.ts ya tiene el mismo prompt que n8n. No se escribió nada.");
} else {
  fs.writeFileSync(SISTEMA, ts.slice(0, arranque) + despues + ts.slice(finLinea));
  console.log(`sistema.ts actualizado: ${prompt.length} caracteres desde el workflow exportado.`);
}
