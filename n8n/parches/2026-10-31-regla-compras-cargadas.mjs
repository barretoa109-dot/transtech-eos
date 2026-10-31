/**
 * Aplica la regla 6 nueva del campo "documento" (v249: usar las compras ya
 * cargadas, no volver a preguntarlas) al gateway EN VIVO.
 *
 *     node n8n/parches/2026-10-31-regla-compras-cargadas.mjs
 *
 * El mismo texto ya está sincronizado a mano en `lib/gateway/sistema.ts` y en
 * el JSON exportado (`n8n/workflows/eos-conversational-gateway-rc1.json`) —
 * committed en el PR que agregó esta regla, para que los tests de
 * consistencia pasaran antes de tocar nada en vivo. Este script es el paso
 * que faltaba: aplicarlo de verdad, con el mismo respaldo + verificación que
 * ya usan los parches anteriores.
 *
 * Después de correrlo: `node n8n/exportar.mjs gateway`, y confirmar que el
 * diff contra lo ya committed da vacío.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicarPrompt } from "./cambio-regla-compras-cargadas.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const ID_GATEWAY = "JRgzUkoHBKgGpyPA";

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

const gateway = await traer(ID_GATEWAY);
respaldar(gateway, "gateway");

const http = nodo(gateway, "HTTP Request");

if (http.parameters.jsonBody.includes("Compras y gastos del negocio YA CARGADOS")) {
  console.log("El gateway en vivo ya tiene la regla 6. No se tocó nada.");
} else {
  http.parameters.jsonBody = aplicarPrompt(http.parameters.jsonBody, "prompt de n8n");
  console.log(`gateway verificado: ${verificarFlujo(gateway, "gateway")} nodos compilan`);
  await subir(ID_GATEWAY, gateway);
  console.log("gateway actualizado: regla 6 (usar las compras ya cargadas) en el prompt.");
}

console.log("Listo. Reexportar con: node n8n/exportar.mjs gateway");
