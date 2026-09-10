/**
 * Que el chat pueda llenar el embudo del CRM.
 *
 *     node n8n/parches/2026-09-10-oportunidad.mjs
 *
 * Tres de las cuatro puntas del gateway: el prompt, la lista blanca del nodo
 * 05 y la ruta del nodo 06. La cuarta —el allowlist del worker— va en
 * `2026-09-10-oportunidad-worker.mjs`.
 *
 * El porqué está en la migración v154: el embudo está construido y probado
 * desde el 26 de agosto y se llena a mano. Es la información que más se
 * pierde, porque una oportunidad nace en una conversación y si no se anota ahí
 * no queda en ningún lado.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

import { aplicar } from "./cambios-oportunidad.mjs";

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

const BLANCA_VIEJA = `    'REGISTRAR_TARJETA',
    'REGISTRAR_COMPRA_TARJETA'
  ]);`;

const BLANCA_NUEVA = `    'REGISTRAR_TARJETA',
    'REGISTRAR_COMPRA_TARJETA',

    /*
      El embudo. No mueve plata ni stock: lo único que toca es la previsión, y
      ahí el riesgo no es el presupuesto sino inventar el monto. Por eso el
      prompt lo prohíbe y la función acepta que la oportunidad entre en cero.
    */
    'REGISTRAR_OPORTUNIDAD'
  ]);`;

const RUTA_VIEJA = `  REGISTRAR_COMPRA_TARJETA: 'eos-worker-rc1-internal'
};`;

const RUTA_NUEVA = `  REGISTRAR_COMPRA_TARJETA: 'eos-worker-rc1-internal',
  REGISTRAR_OPORTUNIDAD: 'eos-worker-rc1-internal'
};`;

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

function cambiar(texto, viejo, nuevo, donde) {
  const partes = texto.split(viejo);
  if (partes.length !== 2) {
    throw new Error(
      `[${donde}] el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
    );
  }
  return partes.join(nuevo);
}

const http = nodo("HTTP Request");
if (http.parameters.jsonBody.includes("REGISTRAR_OPORTUNIDAD")) {
  throw new Error("El prompt ya menciona REGISTRAR_OPORTUNIDAD. No se escribió nada.");
}
http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

const n05 = nodo("05 GW");
n05.parameters.jsCode = cambiar(n05.parameters.jsCode, BLANCA_VIEJA, BLANCA_NUEVA, "05/lista blanca");

const n06 = nodo("06 GW");
n06.parameters.jsCode = cambiar(n06.parameters.jsCode, RUTA_VIEJA, RUTA_NUEVA, "06/paths");

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
console.log("gateway actualizado: prompt, lista blanca del 05 y ruta del 06.");
