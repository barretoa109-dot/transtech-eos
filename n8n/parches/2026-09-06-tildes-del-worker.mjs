/**
 * Las tildes que le faltan al mensaje que ve el usuario.
 *
 *     node n8n/parches/2026-09-06-tildes-del-worker.mjs
 *
 * El worker le pega al final de la respuesta una frase con lo que realmente
 * pasó. Las tres frases de las acciones del negocio se escribieron sin tildes:
 *
 *     "La venta quedo registrada. La ves en Negocio > Ventas."
 *     "Ajuste el stock. Lo ves en Negocio > Productos."
 *     "El contacto quedo guardado. Lo ves en Negocio > Contactos."
 *
 * Las de al lado —tarea, objetivo, memoria— sí las tienen, así que en la misma
 * conversación conviven "La tarea quedó registrada" y "El contacto quedo
 * guardado". No es un detalle de estilo: es la única frase del sistema que
 * confirma que la plata o el stock se movieron, y llega escrita peor que el
 * resto del producto.
 *
 * Verificado en producción el 6 de septiembre de 2026 pidiéndole agendar un
 * contacto: la respuesta terminó, textual, con "El contacto quedo guardado."
 *
 * El texto vive en el nodo "05 INT Resultado" del workflow del worker, y está
 * duplicado en dos ramas del mismo workflow (la interna y la de reintento):
 * se reemplazan las dos, por eso el script cuenta los reemplazos y falla si no
 * encontró ninguno.
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

const CAMBIOS = [
  ["La venta quedo registrada.", "La venta quedó registrada."],
  ["Ajuste el stock.", "Ajusté el stock."],
  ["El contacto quedo guardado.", "El contacto quedó guardado."],
];

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

let total = 0;

for (const nodo of flujo.nodes) {
  if (typeof nodo.parameters?.jsCode !== "string") continue;

  let codigo = nodo.parameters.jsCode;
  let tocado = 0;

  for (const [viejo, nuevo] of CAMBIOS) {
    const partes = codigo.split(viejo);
    if (partes.length > 1) {
      tocado += partes.length - 1;
      codigo = partes.join(nuevo);
    }
  }

  if (tocado > 0) {
    nodo.parameters.jsCode = codigo;
    total += tocado;
    console.log(`  ${nodo.name}: ${tocado} reemplazo(s)`);
  }
}

if (total === 0) {
  throw new Error("No encontré ninguna de las tres frases. No se escribió nada.");
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
console.log(`workflow actualizado (${total} reemplazos).`);

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
