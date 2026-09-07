/**
 * Dar de alta CREAR_PRODUCTO en el workflow del chat.
 *
 *     node n8n/parches/2026-09-07-crear-producto.mjs
 *
 * ============================================================
 * POR QUÉ HACÍA FALTA
 * ============================================================
 *
 * El 7 de septiembre de 2026 a las 17:06, una usuaria escribió:
 *
 *   "Podes ahora agregar en productos
 *    El azul vendo a 168.000gs
 *    Conjunto amarillo 165.000gs
 *    Conjunto cosmina 165.000gs
 *    Top negro sobrepedido 85.000gs"
 *
 * EOS contestó "Voy a guardar estos productos con sus precios de venta" y
 * guardó una MEMORIA. Ningún producto entró al catálogo.
 *
 * No fue el modelo ni la puerta de autonomía: la acción no existía. Sin un
 * verbo para cargar productos, el modelo hizo lo más parecido que sí podía
 * —GUARDAR_MEMORIA— que además funciona, así que la respuesta sonó a que
 * había quedado hecho. La acción que existe tapando a la que falta.
 *
 * ============================================================
 * LOS TRES LUGARES DEL WORKFLOW
 * ============================================================
 *
 * Una acción nueva se da de alta en tres lugares, y si falta uno el modelo la
 * pide y se descarta en silencio:
 *
 *   · las instrucciones del modelo (nodo "HTTP Request"),
 *   · la lista blanca `accionesPermitidas` del nodo 05,
 *   · el mapa `paths` del nodo 06, que la manda a su worker.
 *
 * Del lado de la base ya están hechos los tres `check` y la rama del ejecutor
 * (migraciones v131), y del lado de la aplicación el riesgo en `SYSTEM_RISK` y
 * la traducción de sus errores en `lib/eos/errores-accion.ts`.
 */

import fs from "node:fs";
import path from "node:path";

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

// ---------------------------------------------------- instrucciones del modelo
const LISTA_VIEJA = `AJUSTAR_STOCK
CREAR_CONTACTO

Acciones del negocio (ERP y CRM):`;

const LISTA_NUEVA = `AJUSTAR_STOCK
CREAR_CONTACTO
CREAR_PRODUCTO

Acciones del negocio (ERP y CRM):`;

const FORMA_VIEJA = `CREAR_CONTACTO
  datos: { nombre, ruc?, telefono?, email?, es_proveedor? }
  Nunca inventes el dígito verificador del RUC: mandá el RUC solo y el
  sistema lo calcula.

Reglas de estas tres, que no se negocian:`;

const FORMA_NUEVA = `CREAR_CONTACTO
  datos: { nombre, ruc?, telefono?, email?, es_proveedor? }
  Nunca inventes el dígito verificador del RUC: mandá el RUC solo y el
  sistema lo calcula.

CREAR_PRODUCTO
  datos: { productos: [{ nombre, precio_venta, costo?, stock?, iva?, moneda? }] }
  Es para cargar el catálogo: "agregá estos productos", "el azul lo vendo
  a 168.000". SIEMPRE mandá la lista, aunque sea uno solo.
  El precio_venta es OBLIGATORIO y no se inventa: si no te lo dijeron,
  preguntá a cuánto lo vende. Un producto sin precio hace que la primera
  venta se registre en cero y ensucie el margen de todo el mes.
  El iva es 10 salvo que digan otra cosa; 0 es exenta.
  Si el producto ya existe no se toca: cambiar un precio es otra cosa y
  todavía no la sabés hacer. Decilo así en la respuesta.

Reglas de estas cuatro, que no se negocian:`;

// ------------------------------------------------------------------- nodo 05
const BLANCA_VIEJA = `    'REGISTRAR_VENTA',
    'AJUSTAR_STOCK',
    'CREAR_CONTACTO'
  ]);`;

const BLANCA_NUEVA = `    'REGISTRAR_VENTA',
    'AJUSTAR_STOCK',
    'CREAR_CONTACTO',
    'CREAR_PRODUCTO'
  ]);`;

// ------------------------------------------------------------------- nodo 06
const RUTA_VIEJA = `  REGISTRAR_VENTA: 'eos-worker-rc1-internal',
  AJUSTAR_STOCK: 'eos-worker-rc1-internal',
  CREAR_CONTACTO: 'eos-worker-rc1-internal'
};`;

const RUTA_NUEVA = `  REGISTRAR_VENTA: 'eos-worker-rc1-internal',
  AJUSTAR_STOCK: 'eos-worker-rc1-internal',
  CREAR_CONTACTO: 'eos-worker-rc1-internal',

  /*
    Cargar el catálogo. Deja un efecto durable como las otras tres, así que
    va por el mismo camino interno.
  */
  CREAR_PRODUCTO: 'eos-worker-rc1-internal'
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
  if (!texto.includes(viejo)) {
    throw new Error(`[${donde}] el texto a reemplazar ya no está tal cual. No se escribió nada.`);
  }
  return texto.replace(viejo, nuevo);
}

const http = nodo("HTTP Request");
if (http.parameters.jsonBody.includes("CREAR_PRODUCTO")) {
  throw new Error("El prompt ya menciona CREAR_PRODUCTO. No se escribió nada.");
}
let cuerpo = http.parameters.jsonBody;
cuerpo = cambiar(cuerpo, LISTA_VIEJA, LISTA_NUEVA, "prompt/lista");
cuerpo = cambiar(cuerpo, FORMA_VIEJA, FORMA_NUEVA, "prompt/forma");
http.parameters.jsonBody = cuerpo;

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
