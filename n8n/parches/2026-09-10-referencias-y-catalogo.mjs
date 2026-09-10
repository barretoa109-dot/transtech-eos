/**
 * Que el modelo use el catálogo que ahora sí ve.
 *
 *     SECO=1 node n8n/parches/2026-09-10-referencias-y-catalogo.mjs   (prueba)
 *     node n8n/parches/2026-09-10-referencias-y-catalogo.mjs          (escribe)
 *
 * Toca UN solo lugar: el prompt del nodo `HTTP Request` del gateway. No hay
 * acciones nuevas, así que no se tocan listas blancas ni rutas.
 *
 * El porqué está en `cambios-referencias.mjs`. En una línea: la regla "no
 * adivines nombres, preguntá cuál" se escribió cuando el modelo NO veía el
 * catálogo, y sin catálogo esa regla sólo se podía cumplir preguntando
 * siempre. Desde la v158 el catálogo va en cada mensaje.
 *
 * Después de aplicar hay que correr, en este orden:
 *
 *     node n8n/exportar.mjs gateway
 *     node n8n/parches/sincronizar-prompt.mjs
 *
 * El segundo copia el prompt al repositorio para que `sistema.test.ts` siga
 * viendo el mismo texto de los dos lados.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar } from "./cambios-referencias.mjs";

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

if (http.parameters.jsonBody.includes("EL CATÁLOGO ESTÁ ARRIBA")) {
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
  console.log("gateway actualizado: el prompt ya sabe que el catálogo está adelante.");
  console.log("Seguir con: node n8n/exportar.mjs gateway && node n8n/parches/sincronizar-prompt.mjs");
}
