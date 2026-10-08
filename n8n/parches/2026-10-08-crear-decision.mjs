/**
 * CREAR_DECISION: que el chat registre una decisión explícita (08/10/2026).
 *
 *     SECO=1 node n8n/parches/2026-10-08-crear-decision.mjs   (prueba: no escribe)
 *     node n8n/parches/2026-10-08-crear-decision.mjs          (escribe en PRODUCCIÓN)
 *
 * ESTE PARCHE SE CORRE DESDE `main`, DESPUÉS DEL MERGE. No desde la rama.
 * Va junto con la migración v236 (`eos_crear_decision`) y con las listas de
 * `lib/gateway/` y `lib/autonomia/riesgo.ts` que ya reconocen la acción. El
 * porqué está en `cambios-crear-decision.mjs`.
 *
 * Después de aplicar:
 *
 *     node n8n/exportar.mjs gateway
 *     node n8n/parches/sincronizar-prompt.mjs
 *
 * y se sube el JSON exportado en un PR, como con cualquier parche. (Esta vez
 * el JSON y `sistema.ts` ya se subieron de antemano, con el mismo cambio
 * aplicado localmente y verificado por `sistema.test.ts`: este parche deja
 * PRODUCCIÓN igual a lo que ya está en `main`, no al revés.)
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicarPrompt, aplicarListaWorker } from "./cambios-crear-decision.mjs";

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

await escribir(GATEWAY, gateway, "gateway");

// ------------------------------------------------------------------ worker
// La lista blanca del nodo "01 INT Preparar": sin esto, un día que el
// gateway en TypeScript caiga a n8n, CREAR_DECISION se rechazaría antes de
// pedir autorización (ver `alta-de-acciones.test.ts`).
const worker = await traer(WORKER);
respaldar(worker, "worker");

const preparar = nodo(worker, "01 INT Preparar");
preparar.parameters.jsCode = aplicarListaWorker(preparar.parameters.jsCode, "lista blanca del worker");

await escribir(WORKER, worker, "worker");
