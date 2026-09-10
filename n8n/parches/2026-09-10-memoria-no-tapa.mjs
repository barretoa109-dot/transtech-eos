/**
 * Que GUARDAR_MEMORIA deje de tapar a los verbos que sí existen.
 *
 *     SECO=1 node n8n/parches/2026-09-10-memoria-no-tapa.mjs   (prueba)
 *     node n8n/parches/2026-09-10-memoria-no-tapa.mjs          (escribe)
 *
 * Toca UN solo lugar: el prompt del nodo HTTP Request del gateway. No hay
 * acciones nuevas.
 *
 * El porqué está entero en cambios-memoria-no-tapa.mjs. En una línea:
 * GUARDAR_MEMORIA acepta cualquier texto y nunca falla, así que es la salida
 * cómoda cuando el modelo no encuentra el verbo correcto — y la respuesta
 * suena a que quedó hecho.
 *
 * Después de aplicar, en este orden:
 *
 *     node n8n/exportar.mjs gateway
 *     node n8n/parches/sincronizar-prompt.mjs
 */
import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar } from "./cambios-memoria-no-tapa.mjs";

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
fs.mkdirSync(path.dirname(respaldo), { recursive: true });
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

const http = flujo.nodes.find((n) => n.name === "HTTP Request");
if (!http) throw new Error('No existe el nodo "HTTP Request".');

if (http.parameters.jsonBody.includes("NUNCA la uses para un dato que tiene su propio verbo")) {
  throw new Error("El prompt ya tiene la regla del catálogo. No se escribió nada.");
}

http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

// Antes de escribir: que compile. Un parche que deja el workflow roto tira el
// chat entero y n8n acepta el PUT sin decir nada.
console.log(`verificado: ${verificarFlujo(flujo, "gateway")} nodos compilan`);

if (process.env.SECO === "1") {
  console.log("SECO=1: el anclaje encajó y el workflow compila. No se escribió nada.");
} else {
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
  console.log("gateway actualizado: GUARDAR_MEMORIA ya no tapa a los verbos que existen.");
  console.log("Seguir con: node n8n/exportar.mjs gateway && node n8n/parches/sincronizar-prompt.mjs");
}
