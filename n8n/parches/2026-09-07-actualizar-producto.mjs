/**
 * Dar de alta ACTUALIZAR_PRODUCTO en el workflow del chat.
 *
 *     node n8n/parches/2026-09-07-actualizar-producto.mjs
 *
 * ============================================================
 * POR QUÉ HACÍA FALTA
 * ============================================================
 *
 * El 7 de septiembre de 2026, entre las 17:04 y las 17:08, una usuaria estuvo
 * sacando con EOS el costo real de cuatro prendas: le pasó el precio de cada
 * una y el envío de cada una, y le pidió sumarlos. EOS sumó bien los cuatro.
 * Después le pidió el margen, y EOS calculó bien los cuatro márgenes.
 *
 * Y después guardó todo en una MEMORIA de texto:
 *
 *   "Márgenes de productos: Conjunto azul: precio venta 168.000, costo total
 *    122.414,5, ganancia 45.585,5, margen sobre venta 27,13%…"
 *
 * La columna `costo` de esos cuatro productos siguió en NULL. El panel de
 * rentabilidad siguió sin poder calcular nada. El margen que ella acababa de
 * ver quedó como una frase en una conversación.
 *
 * Es el reporte que llegó, textual: "le pide a EOS por chat que registre sus
 * operaciones y este nunca lo hace, no lo anota ni lo registra en el ERP".
 * No faltaban datos —dio precio, envío, costo y margen de cuatro productos,
 * uno por uno— faltaba el verbo. Con CREAR_PRODUCTO (v131) EOS ya podía dar
 * de alta lo que no existía; sobre lo que YA existe no tenía ninguna acción,
 * y volvía a caer en GUARDAR_MEMORIA, que es la acción que siempre funciona
 * y por eso siempre tapa a la que falta.
 *
 * ============================================================
 * LOS LUGARES
 * ============================================================
 *
 * Acá van tres, los del gateway:
 *
 *   · las instrucciones del modelo (nodo "HTTP Request"),
 *   · la lista blanca `accionesPermitidas` del nodo 05,
 *   · el mapa `paths` del nodo 06.
 *
 * El CUARTO —la lista blanca del nodo `01 INT Preparar` del worker— va en
 * `2026-09-07-actualizar-producto-worker.mjs`, y es el que no da error
 * visible cuando falta.
 *
 * Los cambios del prompt viven en `cambios-actualizar-producto.mjs`, que
 * también usa el script que actualiza `lib/gateway/sistema.ts`: el prompt
 * está en dos lados y tienen que ser el mismo texto.
 */

import fs from "node:fs";
import path from "node:path";

import { aplicar } from "./cambios-actualizar-producto.mjs";

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

async function traer() {
  const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
  if (!r.ok) throw new Error(`GET falló: ${r.status} ${await r.text()}`);
  return r.json();
}

// ------------------------------------------------------------------- nodo 05
const BLANCA_VIEJA = `    'CREAR_CONTACTO',
    'CREAR_PRODUCTO'
  ]);`;

const BLANCA_NUEVA = `    'CREAR_CONTACTO',
    'CREAR_PRODUCTO',
    'ACTUALIZAR_PRODUCTO'
  ]);`;

// ------------------------------------------------------------------- nodo 06
const RUTA_VIEJA = `  CREAR_PRODUCTO: 'eos-worker-rc1-internal'
};`;

const RUTA_NUEVA = `  CREAR_PRODUCTO: 'eos-worker-rc1-internal',

  /*
    Poner el costo y corregir el precio de lo que ya está en el catálogo.
    Deja un efecto durable como las otras, así que va por el mismo camino.
  */
  ACTUALIZAR_PRODUCTO: 'eos-worker-rc1-internal'
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
if (http.parameters.jsonBody.includes("ACTUALIZAR_PRODUCTO")) {
  throw new Error("El prompt ya menciona ACTUALIZAR_PRODUCTO. No se escribió nada.");
}
http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

const n05 = nodo("05 GW");
n05.parameters.jsCode = cambiar(n05.parameters.jsCode, BLANCA_VIEJA, BLANCA_NUEVA, "05/lista blanca");

const n06 = nodo("06 GW");
n06.parameters.jsCode = cambiar(n06.parameters.jsCode, RUTA_VIEJA, RUTA_NUEVA, "06/paths");

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
console.log("workflow actualizado: prompt, lista blanca del 05 y ruta del 06.");

const nuevo = await traer();
for (const n of nuevo.nodes) delete n.credentials;
fs.writeFileSync(
  path.join(RAIZ, "n8n", "workflows", "eos-conversational-gateway-rc1.json"),
  JSON.stringify(
    { name: nuevo.name, nodes: nuevo.nodes, connections: nuevo.connections, settings: nuevo.settings },
    null,
    2,
  ),
);
console.log("reexportado a n8n/workflows/eos-conversational-gateway-rc1.json");
