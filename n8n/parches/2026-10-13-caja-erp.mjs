/**
 * Que el chat pueda decir de qué caja del negocio salió o a cuál entró una
 * venta cobrada, una compra pagada o un cobro/pago de cuenta corriente.
 *
 *     node n8n/parches/2026-10-13-caja-erp.mjs
 *
 * No agrega acciones nuevas — REGISTRAR_VENTA, REGISTRAR_COMPRA,
 * REGISTRAR_COBRO y REGISTRAR_PAGO_COMPRA ya existen y ya están en la lista
 * blanca del nodo 05 y en el ruteo del nodo 06 — así que sólo toca el
 * prompt del nodo "HTTP Request".
 *
 * El porqué está en la migración v242: caja_id y eos_resolver_caja_v240 ya
 * están en producción, y las funciones SQL ya saben qué hacer con un "caja"
 * opcional. Lo único que faltaba era decírselo al modelo.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

import { aplicar } from "./cambios-caja-erp.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "JRgzUkoHBKgGpyPA";

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

async function traer(intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
  return null;
}

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

function nodo(prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

const http = nodo("HTTP Request");
if (http.parameters.jsonBody.includes("caja SOLO si dijo a qué caja entró el cobro")) {
  throw new Error("El prompt ya tiene el párrafo de caja en REGISTRAR_VENTA. No se escribió nada.");
}
http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

// Antes de escribir: que compile. Un parche que deja el workflow roto tira
// el chat entero y n8n acepta el PUT sin decir nada.
console.log(`verificado: ${verificarFlujo(flujo, "gateway")} nodos compilan`);

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
console.log("gateway actualizado: prompt con el párrafo de caja en REGISTRAR_VENTA, REGISTRAR_COMPRA y REGISTRAR_COBRO/REGISTRAR_PAGO_COMPRA.");
console.log("Reexportar con: node n8n/exportar.mjs gateway");
