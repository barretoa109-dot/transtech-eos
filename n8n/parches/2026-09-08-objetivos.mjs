/**
 * Que el chat sepa qué datos lleva un objetivo.
 *
 *     node n8n/parches/2026-09-08-objetivos.mjs
 *
 * Solo toca el prompt. CREAR_OBJETIVO ya está en las cuatro listas blancas de
 * n8n, en el check de la base y en la tabla de riesgo del Worker Gate: lo único
 * que nunca tuvo es la forma de sus datos, así que el modelo mandaba el título
 * a secas y el objetivo entraba sin monto, sin fecha y sin ámbito.
 *
 * Ver `cambios-objetivos.mjs` y la migración v144.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar } from "./cambios-objetivos.mjs";

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
fs.writeFileSync(
  path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`),
  JSON.stringify(flujo, null, 2),
);

const http = flujo.nodes.find((n) => n.name === "HTTP Request");
if (!http) throw new Error("no existe el nodo HTTP Request");
if (http.parameters.jsonBody.includes("datos: { titulo, tipo_medicion")) {
  throw new Error("El prompt ya lo tiene. No se escribió nada.");
}

http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

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
console.log("gateway actualizado.");
