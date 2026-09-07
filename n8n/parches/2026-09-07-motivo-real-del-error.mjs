/**
 * Que el motivo del error llegue al usuario en vez de un AxiosError.
 *
 *     node n8n/parches/2026-09-07-motivo-real-del-error.mjs
 *
 * ============================================================
 * LO QUE PASA HOY
 * ============================================================
 *
 * El nodo "05 INT Respuesta" del worker arma la frase que ve la persona:
 *
 *     respuesta: success ? doneText[accion] : (result.error || 'No fue posible…')
 *
 * Cuando el efecto interno falla, `result` NO es el cuerpo del error: es el
 * objeto de error de Axios que devuelve el nodo HTTP. Entonces `result.error`
 * es un objeto `{ message, name, stack }` y `respuesta` deja de ser un texto.
 *
 * Medido en la ejecución 5863 del 7 de septiembre de 2026, la salida real del
 * nodo 05 fue:
 *
 *     "respuesta": {
 *       "message": "500 - \"{\\\"ok\\\":false,\\\"error\\\":\\\"No fue posible
 *                   ejecutar el efecto interno.\\\"}\"",
 *       "name": "AxiosError",
 *       "stack": "AxiosError: Request failed with status code 500\n at settle
 *                 (/usr/local/lib/node_modules/n8n/…"
 *     }
 *
 * Un rastro de pila con rutas del servidor, en el lugar donde tenía que ir
 * "no encontré a Rossana entre tus contactos". Además de inútil, es un detalle
 * de infraestructura que no tiene por qué salir.
 *
 * ============================================================
 * LO QUE HACE ESTE PARCHE
 * ============================================================
 *
 * Una función que saca el motivo de verdad, en este orden:
 *
 *   1. `result.error` cuando ya es un texto (el caso feliz de siempre).
 *   2. El campo `error` del JSON que viene incrustado en el mensaje de Axios,
 *      que es donde vive la frase que escribió la aplicación.
 *   3. Nada reconocible → la frase genérica de siempre.
 *
 * Y garantiza que `respuesta` sea SIEMPRE un texto. Nunca un objeto, nunca un
 * stack.
 *
 * La otra mitad del arreglo está en el repositorio: hasta ahora la aplicación
 * respondía 500 con "No fue posible ejecutar el efecto interno" para las seis
 * reglas de negocio del ejecutor —producto no encontrado, contacto no
 * encontrado, módulo inactivo—, así que aunque el worker extrajera bien el
 * texto, el texto no decía nada. Ver `lib/eos/errores-accion.ts`.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "iUMdg9fhAg54irmy"; // EOS 4.0 - Background Worker WORKER GATE RC1

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

const AYUDANTE = `
/*
  El motivo de verdad, y siempre como texto.

  Cuando el efecto interno falla, \`result\` es el objeto de error de Axios y
  \`result.error\` es \`{ message, name, stack }\`. Poner eso en \`respuesta\`
  mandaba un rastro de pila con rutas del servidor al chat de la persona, en el
  lugar donde tenía que ir "no encontré a Rossana entre tus contactos".
*/
function motivoDelError(result) {
  const directo = result && result.error;
  if (typeof directo === 'string' && directo.trim()) return directo.trim();

  // Axios mete el cuerpo de la respuesta dentro de su propio \`message\`:
  //   '422 - "{\\"ok\\":false,\\"error\\":\\"No encontré a Rossana…\\"}"'
  const crudo =
    (directo && typeof directo === 'object' && typeof directo.message === 'string' && directo.message) ||
    (result && typeof result.message === 'string' && result.message) ||
    '';

  const json = crudo.match(/\\{[\\s\\S]*\\}/);

  if (json) {
    try {
      const cuerpo = JSON.parse(JSON.parse('"' + json[0].replace(/"/g, '\\\\"') + '"'));
      if (cuerpo && typeof cuerpo.error === 'string' && cuerpo.error.trim()) return cuerpo.error.trim();
    } catch (e) {
      try {
        const cuerpo = JSON.parse(json[0]);
        if (cuerpo && typeof cuerpo.error === 'string' && cuerpo.error.trim()) return cuerpo.error.trim();
      } catch (e2) { /* se cae al genérico */ }
    }
  }

  return 'No fue posible completar la acción interna.';
}
`;

const VIEJO_RESPUESTA = `    respuesta: success
      ? (doneText[prep.accion] || 'La acción quedó completada.')
      : (result.error || 'No fue posible completar la acción interna.')`;

const NUEVO_RESPUESTA = `    respuesta: success
      ? (doneText[prep.accion] || 'La acción quedó completada.')
      : motivoDelError(result)`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

let tocados = 0;

for (const nodo of flujo.nodes) {
  if (typeof nodo.parameters?.jsCode !== "string") continue;
  if (!nodo.parameters.jsCode.includes(VIEJO_RESPUESTA)) continue;
  if (nodo.parameters.jsCode.includes("motivoDelError")) {
    throw new Error(`El nodo "${nodo.name}" ya está parcheado. No se escribió nada.`);
  }

  nodo.parameters.jsCode = AYUDANTE + nodo.parameters.jsCode.replace(VIEJO_RESPUESTA, NUEVO_RESPUESTA);
  tocados += 1;
  console.log(`  ${nodo.name}: parcheado`);
}

if (tocados === 0) {
  throw new Error("No encontré el armado de `respuesta` tal cual. No se escribió nada.");
}

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
