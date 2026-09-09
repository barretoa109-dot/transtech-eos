/**
 * Que el chat pueda anotar cuánta plata hay en una cuenta.
 *
 *     node n8n/parches/2026-09-09-declarar-saldo.mjs
 *
 * Tres de las cuatro puntas del gateway: el prompt, la lista blanca del nodo
 * 05 y la ruta del nodo 06. La cuarta —el allowlist del worker— va en
 * `2026-09-09-declarar-saldo-worker.mjs`.
 *
 * El porqué está en la migración v149: el saldo de una cuenta es el número
 * del que dependen el patrimonio, el disponible real y la cobertura del fondo
 * de emergencia, y era el único que obligaba a salir del chat para cargarlo.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

import { aplicar } from "./cambios-declarar-saldo.mjs";

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

// ------------------------------------------------------------------- nodo 05
const BLANCA_VIEJA = `    'CORREGIR_MOVIMIENTO'
  ]);`;

const BLANCA_NUEVA = `    'CORREGIR_MOVIMIENTO',

    /*
      Anotar cuánta plata hay en una cuenta. Es la que más se va a usar de
      todas las de finanzas: el saldo cambia cada vez que la persona mira su
      homebanking, y de él dependen el patrimonio, el disponible real y la
      cobertura del fondo de emergencia.
    */
    'DECLARAR_SALDO'
  ]);`;

// ------------------------------------------------------------------- nodo 06
const RUTA_VIEJA = `  CORREGIR_MOVIMIENTO: 'eos-worker-rc1-internal'
};`;

const RUTA_NUEVA = `  CORREGIR_MOVIMIENTO: 'eos-worker-rc1-internal',

  /*
    Declarar un saldo va por el camino interno como el resto: deja un efecto
    durable. Lo que la distingue —que escribe sobre una cuenta que ya existía,
    o la crea— lo resuelve el ejecutor, no la ruta.
  */
  DECLARAR_SALDO: 'eos-worker-rc1-internal'
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
if (http.parameters.jsonBody.includes("DECLARAR_SALDO")) {
  throw new Error("El prompt ya menciona DECLARAR_SALDO. No se escribió nada.");
}
http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

const n05 = nodo("05 GW");
n05.parameters.jsCode = cambiar(n05.parameters.jsCode, BLANCA_VIEJA, BLANCA_NUEVA, "05/lista blanca");

const n06 = nodo("06 GW");
n06.parameters.jsCode = cambiar(n06.parameters.jsCode, RUTA_VIEJA, RUTA_NUEVA, "06/paths");

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
console.log("gateway actualizado: prompt, lista blanca del 05 y ruta del 06.");
console.log("Reexportar con: node n8n/exportar.mjs gateway");
