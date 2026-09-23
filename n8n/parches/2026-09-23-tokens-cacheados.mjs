/**
 * Los tokens cacheados de OpenAI viajan hasta la aplicación (punto 8).
 *
 *     SECO=1 node n8n/parches/2026-09-23-tokens-cacheados.mjs   (prueba: no escribe)
 *     node n8n/parches/2026-09-23-tokens-cacheados.mjs          (escribe)
 *
 * Solo el gateway (nodos "05 GW Preparar Respuesta" y "08 GW Agregar
 * Resultados Worker"). El porqué está en `cambios-tokens-cacheados.mjs`.
 *
 * No depende de ninguna migración. Para que el costo baje de verdad hace falta
 * además la variable EOS_USD_POR_MTOK_ENTRADA_CACHEADA en Vercel (sin ella los
 * cacheados se siguen cobrando a tarifa completa, como antes).
 *
 * Después de aplicar:
 *
 *     node n8n/exportar.mjs gateway
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar05, aplicar08 } from "./cambios-tokens-cacheados.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const GATEWAY = "JRgzUkoHBKgGpyPA";

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

function nodo(flujo, prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

function respaldar(flujo, etiqueta) {
  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const destino = path.join(RAIZ, "n8n", "respaldos", `${sello}-${etiqueta}.json`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, destino)} (updatedAt ${flujo.updatedAt})`);
}

async function escribir(id, flujo, etiqueta) {
  console.log(`verificado ${etiqueta}: ${verificarFlujo(flujo, etiqueta)} nodos compilan`);

  if (process.env.SECO === "1") return;

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

  if (!r.ok) throw new Error(`PUT ${etiqueta} falló: ${r.status} ${await r.text()}`);
  console.log(`${etiqueta} actualizado.`);
}

// ------------------------------------------------------------------ gateway
const gateway = await traer(GATEWAY);
respaldar(gateway, "gateway");

const g05 = nodo(gateway, "05 GW Preparar Respuesta");
g05.parameters.jsCode = aplicar05(g05.parameters.jsCode, "05 GW Preparar Respuesta");

const g08 = nodo(gateway, "08 GW Agregar Resultados Worker");
g08.parameters.jsCode = aplicar08(g08.parameters.jsCode, "08 GW Agregar Resultados Worker");

await escribir(GATEWAY, gateway, "gateway");
