/**
 * Dar de alta REGISTRAR_DEUDA y REGISTRAR_PAGO_DEUDA.
 *
 *     node n8n/parches/2026-09-07-registrar-compra.mjs
 *
 * ============================================================
 * POR QUÉ HACÍA FALTA
 * ============================================================
 *
 * El 7 de septiembre de 2026 el dueño del producto le dictó a EOS los números
 * de un negocio de porcicultura que acababa de arrancar: combustible 600.000,
 * seis lechones por 1.750.000, tres bolsas de balanceado a 68.000, vitamina
 * 64.000, antiparasitario 20.000, y el capataz 750.000 cada 15 días. Le pidió
 * expresamente "guardalo también todo en mi área de negocios".
 *
 * EOS entendió todo y sumó bien —"inversión inicial ₲ 3.388.000"— y lo guardó
 * en una MEMORIA. Cuando le preguntaron si lo había puesto en el ERP,
 * contestó la verdad: "lo guardé como memoria empresarial, no como registros
 * operativos del ERP/CRM". Y cuando le insistieron, dijo exactamente qué le
 * faltaba:
 *
 *   "los gastos como combustible, alimento, vitaminas, antiparasitario y
 *    capataz los tengo para seguimiento, pero NO HAY UNA ACCIÓN OPERATIVA DE
 *    GASTOS DISPONIBLE EN ESTE PANEL."
 *
 * Tenía razón. Las acciones cubrían la plata que entra, el inventario, la
 * agenda y el catálogo. Ninguna cubría **la plata que sale**, que en un
 * negocio que arranca es todo lo que pasa: se compra durante meses antes de
 * vender por primera vez.
 *
 * ============================================================
 * LOS LUGARES
 * ============================================================
 *
 * Acá van tres, los del gateway: el prompt (nodo "HTTP Request"), la lista
 * blanca del 05 y el mapa `paths` del 06. El CUARTO —la lista blanca del nodo
 * `01 INT Preparar` del worker— va en
 * `2026-09-07-registrar-compra-worker.mjs`, y es el que no da error visible
 * cuando falta.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

import { aplicar } from "./cambios-deudas.mjs";

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
const BLANCA_VIEJA = `    'REGISTRAR_MOVIMIENTO_PERSONAL',
    'REGISTRAR_TRANSFERENCIA'
  ]);`;

const BLANCA_NUEVA = `    'REGISTRAR_MOVIMIENTO_PERSONAL',
    'REGISTRAR_TRANSFERENCIA',
    'REGISTRAR_DEUDA',
    'REGISTRAR_PAGO_DEUDA'
  ]);`;

// ------------------------------------------------------------------- nodo 06
const RUTA_VIEJA = `  REGISTRAR_TRANSFERENCIA: 'eos-worker-rc1-internal'
};`;

const RUTA_NUEVA = `  REGISTRAR_TRANSFERENCIA: 'eos-worker-rc1-internal',

  /*
    Las deudas. Mismo camino interno: lo que cambia es que el pago escribe en
    dos tablas, y eso lo resuelve el ejecutor, no la ruta.
  */
  REGISTRAR_DEUDA: 'eos-worker-rc1-internal',
  REGISTRAR_PAGO_DEUDA: 'eos-worker-rc1-internal'
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
    throw new Error(`[${donde}] el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
  }
  return partes.join(nuevo);
}

const http = nodo("HTTP Request");
if (http.parameters.jsonBody.includes("REGISTRAR_PAGO_DEUDA")) {
  throw new Error("El prompt ya menciona REGISTRAR_PAGO_DEUDA. No se escribió nada.");
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
