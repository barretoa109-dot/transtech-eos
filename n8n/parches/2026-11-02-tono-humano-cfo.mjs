/**
 * Aplica la corrección del párrafo de tono (02/11/2026: CFO de carne y
 * hueso, no "directo y corto") al gateway EN VIVO.
 *
 *     node n8n/parches/2026-11-02-tono-humano-cfo.mjs
 *
 * Corre esto EN VEZ de `2026-11-02-memoria-y-tono.mjs` si ese todavía no se
 * aplicó: este script detecta los dos casos (el texto viejo "directo y
 * corto" sin aplicar, o ya aplicado y por corregir) y deja el gateway con el
 * texto final en cualquiera de los dos.
 *
 * Después de correrlo: `node n8n/exportar.mjs gateway`, y confirmar que el
 * diff contra lo ya committed da vacío.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicarPrompt as aplicarMemoriaYTono } from "./cambio-memoria-y-tono.mjs";
import { aplicarPrompt as aplicarCorreccionTono } from "./cambio-tono-humano-cfo.mjs";

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

const FRASE_FINAL = "Contestá como un CFO de carne y hueso";
const FRASE_VIEJA_SIN_CORREGIR = "Contestá directo y corto, como alguien que te está ayudando de verdad";
const FRASE_MEMORIA = "TAMBIÉN guardala cuando la persona te da un dato que vas a necesitar de";

const gateway = await traer(ID_GATEWAY);
respaldar(gateway, "gateway");

const http = nodo(gateway, "HTTP Request");
let texto = http.parameters.jsonBody;

if (texto.includes(FRASE_FINAL)) {
  console.log("El gateway en vivo ya tiene el tono final (CFO de carne y hueso). No se tocó nada.");
} else {
  // Si todavía no tiene ni la memoria proactiva ni el párrafo de tono (el
  // deploy de #303 nunca se corrió), aplicar ese cambio primero.
  if (!texto.includes(FRASE_MEMORIA) && !texto.includes(FRASE_VIEJA_SIN_CORREGIR)) {
    texto = aplicarMemoriaYTono(texto, "prompt de n8n (memoria y tono base)");
  }
  texto = aplicarCorreccionTono(texto, "prompt de n8n (corrección de tono)");

  http.parameters.jsonBody = texto;
  console.log(`gateway verificado: ${verificarFlujo(gateway, "gateway")} nodos compilan`);
  await subir(ID_GATEWAY, gateway);
  console.log("gateway actualizado: tono humano de CFO (no corto ni seco).");
}

console.log("Listo. Reexportar con: node n8n/exportar.mjs gateway");
