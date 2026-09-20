/**
 * El chat le escribe a un cliente por WhatsApp ("sí, escribile").
 *
 *     SECO=1 node n8n/parches/2026-09-19-chat-escribe-cliente.mjs   (prueba: no escribe)
 *     node n8n/parches/2026-09-19-chat-escribe-cliente.mjs          (escribe)
 *
 * gateway: el prompt (HTTP Request), la lista blanca (05 GW) y la ruta (06 GW).
 * worker:  la lista blanca (01 INT) y la frase (05 INT Respuesta).
 *
 * El porqué está en `cambios-chat-escribe-cliente.mjs` y en la migración v186.
 *
 * ORDEN: la migración v186 se aplica ANTES que esto. Si el prompt empieza a emitir
 * ENVIAR_WHATSAPP_CLIENTE y la base todavía no lo acepta, el CHECK de
 * `eos_action_commands` lo rechaza y la persona lee "no pude" sin motivo.
 *
 * Después de aplicar:
 *
 *     node n8n/exportar.mjs
 *     node n8n/parches/sincronizar-prompt.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicarPrompt, aplicarWorker, aplicar05Gw, aplicar06Gw, aplicar01Int } from "./cambios-chat-escribe-cliente.mjs";

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

const n05 = nodo(gateway, "05 GW");
n05.parameters.jsCode = aplicar05Gw(n05.parameters.jsCode);

const n06 = nodo(gateway, "06 GW");
n06.parameters.jsCode = aplicar06Gw(n06.parameters.jsCode);

// ------------------------------------------------------------------- worker
const worker = await traer(WORKER);
respaldar(worker, "worker");

const w01 = nodo(worker, "01 INT");
w01.parameters.jsCode = aplicar01Int(w01.parameters.jsCode);

const w05 = nodo(worker, "05 INT Respuesta");
w05.parameters.jsCode = aplicarWorker(w05.parameters.jsCode, "05 INT Respuesta");

await escribir(GATEWAY, gateway, "gateway");
await escribir(WORKER, worker, "worker");
