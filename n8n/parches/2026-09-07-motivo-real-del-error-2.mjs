/**
 * Corrección del parche anterior: el motivo seguía sin salir.
 *
 *     node n8n/parches/2026-09-07-motivo-real-del-error-2.mjs
 *
 * El parche de las 02:25 hizo bien la mitad del trabajo —`respuesta` dejó de
 * ser un objeto con un stack— pero su extractor no acertaba el formato real, y
 * caía siempre a la frase genérica. Probado contra producción, así llega el
 * mensaje de Axios cuando la aplicación responde 422:
 *
 *     422 - "{\"ok\":false,\"code\":\"EOS_ACCION_CONTACTO_NO_RESUELTO\",
 *             \"error\":\"No encontré a \\\"Rossana\\\" entre tus contactos…\"}"
 *
 * O sea: un código, un guion, y después **un literal JSON de texto** que
 * adentro tiene otro JSON. Hay dos niveles de escape, y el mensaje de la
 * aplicación tiene comillas propias en el tercero.
 *
 * El intento anterior buscaba `{ … }` con una expresión regular y le
 * reescribía las comillas a mano. Con tres niveles eso no cierra nunca.
 *
 * Lo correcto es no adivinar: desde la PRIMERA comilla, lo que queda es un
 * literal JSON completo. `JSON.parse` una vez devuelve el texto del cuerpo, y
 * `JSON.parse` otra vez devuelve el objeto. Sin expresiones regulares y sin
 * tocar comillas.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "iUMdg9fhAg54irmy";

function env() {
  const texto = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8");
  const valores = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) valores[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return valores;
}

const { N8N_BASE_URL, N8N_API_KEY } = env();
const BASE = N8N_BASE_URL.replace(/\/$/, "");
const CABECERAS = { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" };

async function traer() {
  const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
  if (!r.ok) throw new Error(`GET falló: ${r.status} ${await r.text()}`);
  return r.json();
}

const NUEVO_AYUDANTE = `
/*
  El motivo de verdad, y siempre como texto.

  Cuando el efecto interno falla, \`result\` es el objeto de error de Axios y
  \`result.error\` es \`{ message, name, stack }\`. Poner eso en \`respuesta\`
  mandaba un rastro de pila con rutas del servidor al chat de la persona.

  Y el cuerpo de la respuesta viene con DOS niveles de escape adentro del
  mensaje de Axios:

      422 - "{\\"ok\\":false,\\"error\\":\\"No encontré a \\\\\\"Rossana\\\\\\"…\\"}"

  Desde la primera comilla, eso es un literal JSON completo: parsearlo una vez
  da el texto del cuerpo, parsearlo otra vez da el objeto. Sin expresiones
  regulares y sin reescribir comillas a mano, que es donde falló el primer
  intento.
*/
function motivoDelError(result) {
  const directo = result && result.error;
  if (typeof directo === 'string' && directo.trim()) return directo.trim();

  const crudo =
    (directo && typeof directo === 'object' && typeof directo.message === 'string' && directo.message) ||
    (result && typeof result.message === 'string' && result.message) ||
    '';

  const comilla = crudo.indexOf('"');

  if (comilla >= 0) {
    try {
      const cuerpo = JSON.parse(JSON.parse(crudo.slice(comilla)));
      if (cuerpo && typeof cuerpo.error === 'string' && cuerpo.error.trim()) {
        return cuerpo.error.trim();
      }
    } catch (e) { /* sigue abajo */ }
  }

  // Por si algún día el cuerpo llega sin envolver en un literal de texto.
  const llave = crudo.indexOf('{');
  if (llave >= 0) {
    try {
      const cuerpo = JSON.parse(crudo.slice(llave));
      if (cuerpo && typeof cuerpo.error === 'string' && cuerpo.error.trim()) {
        return cuerpo.error.trim();
      }
    } catch (e) { /* se cae al genérico */ }
  }

  return 'No fue posible completar la acción interna.';
}
`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string" || !codigo.includes("function motivoDelError(result)")) continue;

  // Se reemplaza el ayudante entero, desde su comentario hasta su cierre.
  const inicio = codigo.indexOf("\n/*\n  El motivo de verdad");
  const marca = "\n  return 'No fue posible completar la acción interna.';\n}\n";
  const fin = codigo.indexOf(marca);

  if (inicio < 0 || fin < 0) {
    throw new Error(`No pude ubicar el ayudante en "${nodo.name}". No se escribió nada.`);
  }

  nodo.parameters.jsCode = NUEVO_AYUDANTE + codigo.slice(fin + marca.length);
  tocados += 1;
  console.log(`  ${nodo.name}: ayudante reemplazado`);
}

if (tocados === 0) throw new Error("No encontré el ayudante. ¿Se aplicó el parche anterior?");

const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, {
  method: "PUT",
  headers: CABECERAS,
  body: JSON.stringify({
    name: flujo.name,
    nodes: flujo.nodes,
    connections: flujo.connections,
    settings: flujo.settings ?? {},
  }),
});

if (!r.ok) throw new Error(`PUT falló: ${r.status} ${await r.text()}`);
console.log(`workflow actualizado (${tocados} nodo/s).`);

const nuevo = await traer();
for (const n of nuevo.nodes) delete n.credentials;
fs.writeFileSync(
  path.join(RAIZ, "n8n", "workflows", "eos-background-worker-rc1.json"),
  JSON.stringify(
    { name: nuevo.name, nodes: nuevo.nodes, connections: nuevo.connections, settings: nuevo.settings },
    null,
    2,
  ),
);
console.log("reexportado a n8n/workflows/eos-background-worker-rc1.json");
