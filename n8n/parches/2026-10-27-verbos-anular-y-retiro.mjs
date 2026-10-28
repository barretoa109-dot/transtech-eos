/**
 * Aplica los dos verbos nuevos (v248, ANULAR_MOVIMIENTO y
 * REGISTRAR_RETIRO_PERSONAL) a los DOS workflows en vivo: el prompt del
 * gateway y la lista blanca del Worker.
 *
 *     node n8n/parches/2026-10-27-verbos-anular-y-retiro.mjs
 *
 * El mismo texto ya está sincronizado a mano en `lib/gateway/sistema.ts` y
 * en los dos JSON exportados (`n8n/workflows/*.json`) — committed en el PR
 * que agregó estos dos verbos, para que los tests de consistencia pasaran
 * antes de tocar nada en vivo. Este script es el paso que faltaba: aplicarlo
 * de verdad a n8n, con el mismo respaldo + verificación que ya usa
 * `2026-10-13-ventana-30-dias.mjs`.
 *
 * Después de correrlo: `node n8n/exportar.mjs gateway` y
 * `node n8n/exportar.mjs worker`, y confirmar que el diff contra lo ya
 * committed da vacío (si el texto de verdad coincidía, no debería cambiar
 * nada más que metadatos de n8n como `updatedAt`/`versionId`).
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicarAllowlist, aplicarPrompt } from "./cambios-verbos-anular-y-retiro.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const ID_GATEWAY = "JRgzUkoHBKgGpyPA";
const ID_WORKER = "iUMdg9fhAg54irmy";

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

async function traer(id, intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: CABECERAS });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
  return null;
}

async function subir(id, flujo) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
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
}

function respaldar(flujo, sufijo) {
  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-${sufijo}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);
}

function nodo(flujo, prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

// ------------------------------------------------------------------
// 1) El gateway: el prompt del nodo HTTP Request
// ------------------------------------------------------------------

const gateway = await traer(ID_GATEWAY);
respaldar(gateway, "gateway");

const http = nodo(gateway, "HTTP Request");

if (http.parameters.jsonBody.includes("REGISTRAR_RETIRO_PERSONAL")) {
  console.log("El gateway en vivo ya tiene REGISTRAR_RETIRO_PERSONAL. No se tocó nada.");
} else {
  http.parameters.jsonBody = aplicarPrompt(http.parameters.jsonBody, "prompt de n8n");
  console.log(`gateway verificado: ${verificarFlujo(gateway, "gateway")} nodos compilan`);
  await subir(ID_GATEWAY, gateway);
  console.log("gateway actualizado: ANULAR_MOVIMIENTO y REGISTRAR_RETIRO_PERSONAL en el prompt.");
}

// ------------------------------------------------------------------
// 2) El worker: la lista blanca del nodo 01 INT Preparar
// ------------------------------------------------------------------

const worker = await traer(ID_WORKER);
respaldar(worker, "worker");

const preparar = nodo(worker, "01 INT Preparar");

if (preparar.parameters.jsCode.includes("REGISTRAR_RETIRO_PERSONAL")) {
  console.log("El worker en vivo ya tiene REGISTRAR_RETIRO_PERSONAL. No se tocó nada.");
} else {
  preparar.parameters.jsCode = aplicarAllowlist(preparar.parameters.jsCode, "allowlist del worker");
  console.log(`worker verificado: ${verificarFlujo(worker, "worker")} nodos compilan`);
  await subir(ID_WORKER, worker);
  console.log("worker actualizado: ANULAR_MOVIMIENTO y REGISTRAR_RETIRO_PERSONAL en la lista blanca.");
}

console.log("Listo. Reexportar con: node n8n/exportar.mjs gateway && node n8n/exportar.mjs worker");
