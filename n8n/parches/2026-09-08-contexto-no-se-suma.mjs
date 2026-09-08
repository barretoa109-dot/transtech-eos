/**
 * Que el modelo no sume la plata del negocio con la de la persona.
 *
 *     node n8n/parches/2026-09-08-contexto-no-se-suma.mjs
 *
 * Desde la v137 el contexto llega con dos bloques rotulados —"Movimientos del
 * mes (NEGOCIO)" y "Movimientos del mes (VOS, personal)"— con la misma forma y
 * cifras incompatibles.
 *
 * El prompt ya le dice al modelo dónde ESCRIBIR cada cosa. Esto es la otra
 * mitad: qué hacer al LEER. Sin una línea que lo diga, dos listas de números
 * parecidos invitan a sumarlas, y "este mes te entraron 12.200.000" —la venta
 * del negocio más el sueldo— es una cifra que no existe en ningún lado y que
 * suena perfectamente creíble.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

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

const VIEJO = `Lo que sabés de esta persona y de su negocio (datos reales, de hoy):`;

const NUEVO = `Lo que sabés de esta persona y de su negocio (datos reales, de hoy).
Si ves un bloque NEGOCIO y otro VOS, es plata distinta y NO se suma:
una cosa es cómo va el negocio y otra cómo le va a la persona.`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(
  path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`),
  JSON.stringify(flujo, null, 2),
);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string" || !codigo.includes(VIEJO)) continue;
  if (codigo.includes("NO se suma")) {
    throw new Error(`El nodo "${nodo.name}" ya está parcheado. No se escribió nada.`);
  }

  nodo.parameters.jsCode = codigo.replace(VIEJO, NUEVO);
  tocados += 1;
  console.log(`  ${nodo.name}: parcheado`);
}

if (tocados !== 1) throw new Error(`Esperaba 1 nodo y toqué ${tocados}. No se escribió nada.`);

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
console.log("gateway actualizado. Reexportar con: node n8n/exportar.mjs gateway");
