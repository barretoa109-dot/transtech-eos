/**
 * El costo que EOS ya sabe viaja con la venta (25/09/2026), del lado de n8n.
 *
 *     SECO=1 node n8n/parches/2026-09-25-venta-con-costo.mjs   (prueba: no escribe)
 *     node n8n/parches/2026-09-25-venta-con-costo.mjs          (escribe)
 *
 * gateway: el prompt (nodo HTTP Request) y el nodo "06 GW Preparar Jobs Worker",
 *          que copia a la venta el costo que el modelo escribió en el texto
 *          si se olvidó de mandarlo (`cambios-costo-del-texto.mjs`).
 * worker:  la frase de la venta (nodo "05 INT Respuesta").
 *
 * El porqué está en `cambios-venta-con-costo.mjs` y en la migración v198.
 *
 * ORDEN: la migración v198 se aplica ANTES que esto. Sin ella el ejecutor
 * ignora `costo_unitario` y todo sigue como hoy (no se rompe nada, pero el
 * costo se sigue perdiendo).
 *
 * Después de aplicar:
 *
 *     node n8n/exportar.mjs
 *     node n8n/parches/sincronizar-prompt.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar as aplicarCostoDelTexto } from "./cambios-costo-del-texto.mjs";
import { aplicarPrompt, aplicarWorker } from "./cambios-venta-con-costo.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const GATEWAY = "JRgzUkoHBKgGpyPA";
const WORKER = "iUMdg9fhAg54irmy";

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

const http = nodo(gateway, "HTTP Request");
http.parameters.jsonBody = aplicarPrompt(http.parameters.jsonBody, "prompt de n8n");

const g06 = nodo(gateway, "06 GW Preparar Jobs Worker");
g06.parameters.jsCode = aplicarCostoDelTexto(g06.parameters.jsCode, "06 GW Preparar Jobs Worker");

// ------------------------------------------------------------------- worker
const worker = await traer(WORKER);
respaldar(worker, "worker");

const w05 = nodo(worker, "05 INT Respuesta");
w05.parameters.jsCode = aplicarWorker(w05.parameters.jsCode, "05 INT Respuesta");

await escribir(GATEWAY, gateway, "gateway");
await escribir(WORKER, worker, "worker");
