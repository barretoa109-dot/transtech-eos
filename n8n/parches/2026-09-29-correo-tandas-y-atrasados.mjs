/**
 * El flujo de correo procesa la tanda entera y no contesta correos viejos.
 *
 *     SECO=1 node n8n/parches/2026-09-29-correo-tandas-y-atrasados.mjs   (prueba)
 *     node n8n/parches/2026-09-29-correo-tandas-y-atrasados.mjs          (escribe)
 *
 * Visto el 29/09/2026, apenas el flujo volvió a correr (ver
 * 2026-09-29-correo-sin-ida-y-vuelta.mjs):
 *
 * 1. EL ATRASO. Al reactivarse, el disparador de Gmail empezó a recorrer lo
 *    acumulado en la casilla, diez correos por minuto, incluidos correos de
 *    mediados de septiembre. Un correo viejo de una persona real habría
 *    recibido ahora una respuesta con semanas de atraso. Se ignora todo lo
 *    recibido hace más de 24 horas (`internalDate`).
 *
 * 2. LA TANDA. "Preparar correo EOS1" y "Preparar envío EOS1" corren "una vez
 *    para todos" pero leían `$json`, que en ese modo es SOLO el primer ítem:
 *    de cada tanda de hasta diez correos se miraba el primero y los otros
 *    nueve se perdían sin rastro. Ahora recorren `$input.all()`, y un correo
 *    que no se puede leer se saltea sin tirar la tanda entera.
 *
 * 3. LAS ETIQUETAS. Con "Simplify", Gmail entrega `labels` (no `labelIds`), así
 *    que el filtro de correos masivos del parche anterior nunca veía nada.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const CORREO = "fUrFN1LTuqiUlKgq";
const MARCA = "// Recorre la tanda entera";

function env() {
  if (process.env.N8N_BASE_URL && process.env.N8N_API_KEY) return process.env;
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

function envolver(codigo, { soloRecientes }) {
  const cuerpo = codigo.replace(/^const j = \$json;\s*\n/, "");
  if (cuerpo === codigo) throw new Error("El nodo no empieza con `const j = $json;`. No se tocó nada.");
  return `${MARCA} (ver n8n/parches/2026-09-29-correo-tandas-y-atrasados.mjs).
const procesar = (j) => {
${cuerpo}
};

const salida = [];
${soloRecientes ? "const MAXIMO_MS = 24 * 60 * 60 * 1000;\n" : ""}for (const item of $input.all()) {
  const j = item.json;
${soloRecientes ? "  const recibido = Number(j.internalDate || 0);\n  if (!recibido || Date.now() - recibido > MAXIMO_MS) continue;\n" : ""}  try {
    const r = procesar(j);
    if (Array.isArray(r)) salida.push(...r);
  } catch (error) {
    // Un correo ilegible no tira la tanda entera.
  }
}
return salida;
`;
}

async function aplicar() {
  const r0 = await fetch(`${BASE}/api/v1/workflows/${CORREO}`, { headers: CABECERAS });
  if (!r0.ok) throw new Error(`GET ${r0.status}`);
  const flujo = await r0.json();

  const preparar = flujo.nodes.find((n) => n.name === "Preparar correo EOS1");
  const envio = flujo.nodes.find((n) => n.name === "Preparar envío EOS1");
  if (!preparar || !envio) throw new Error("Faltan los nodos de preparación. No se tocó nada.");

  const codigoPreparar = preparar.parameters.jsCode.replace(/\r\n/g, "\n");
  if (codigoPreparar.includes(MARCA)) {
    console.log("El flujo ya recorre la tanda entera. Nada que hacer.");
    return;
  }
  if (!codigoPreparar.includes("getWorkflowStaticData")) {
    throw new Error("Falta el parche anterior (2026-09-29-correo-sin-ida-y-vuelta). No se tocó nada.");
  }
  for (const n of [preparar, envio]) {
    if (n.parameters.mode === "runOnceForEachItem") throw new Error(`"${n.name}" corre por ítem. Revisar.`);
  }

  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-correo.json`);
  fs.mkdirSync(path.dirname(respaldo), { recursive: true });
  fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

  const etiquetasViejas = "const etiquetas = Array.isArray(j.labelIds) ? j.labelIds : [];";
  if (!codigoPreparar.includes(etiquetasViejas)) throw new Error("Cambió la lectura de etiquetas. No se tocó nada.");
  const conEtiquetas = codigoPreparar.replace(
    etiquetasViejas,
    "const etiquetas = Array.isArray(j.labelIds)\n  ? j.labelIds\n  : (Array.isArray(j.labels) ? j.labels.map((l) => (l && l.id) || l) : []);",
  );

  preparar.parameters.jsCode = envolver(conEtiquetas, { soloRecientes: true });
  envio.parameters.jsCode = envolver(envio.parameters.jsCode.replace(/\r\n/g, "\n"), { soloRecientes: false });
  for (const n of flujo.nodes) delete n.settings;

  console.log(`verificado correo: ${verificarFlujo(flujo, "correo")} nodos compilan`);
  if (process.env.SECO === "1") {
    console.log("SECO=1: no se escribió nada.");
    return;
  }

  const r = await fetch(`${BASE}/api/v1/workflows/${CORREO}`, {
    method: "PUT",
    headers: CABECERAS,
    body: JSON.stringify({ name: flujo.name, nodes: flujo.nodes, connections: flujo.connections, settings: flujo.settings ?? {} }),
  });
  if (!r.ok) throw new Error(`PUT falló: ${r.status} ${await r.text()}`);
  console.log("correo actualizado.");
}

await aplicar();
