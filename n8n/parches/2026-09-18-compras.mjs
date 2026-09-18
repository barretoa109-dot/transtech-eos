/**
 * ANULAR_COMPRA y CORREGIR_COMPRA, en los cuatro lugares de n8n.
 *
 *     SECO=1 node n8n/parches/2026-09-18-compras.mjs   (prueba)
 *     node n8n/parches/2026-09-18-compras.mjs          (escribe)
 *
 * gateway: el prompt (nodo HTTP Request), la lista blanca del 05 y la ruta
 *          del 06.
 * worker:  el allowlist del 01 INT y las dos frases del 05 INT.
 *
 * El porqué está en `cambios-compras.mjs` y en la migración v170.
 *
 * ORDEN: la migración v170 se aplica ANTES que esto. Si el gateway empieza a
 * mandar una acción que la base todavía no acepta (los check de acción), el
 * comando falla en silencio.
 *
 * Después de aplicar:
 *
 *     node n8n/exportar.mjs
 *     node n8n/parches/sincronizar-prompt.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar } from "./cambios-compras.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const GATEWAY = "JRgzUkoHBKgGpyPA";
const WORKER = "iUMdg9fhAg54irmy";

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

async function traer(id, intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: CABECERAS });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
  return null;
}

function cambiar(texto, viejo, nuevo, donde) {
  const partes = texto.split(viejo);
  if (partes.length !== 2) {
    throw new Error(`[${donde}] el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
  }
  return partes.join(nuevo);
}

function nodo(flujo, prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

function respaldar(flujo, etiqueta) {
  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const destino = path.join(RAIZ, "n8n", "respaldos", `${sello}-${etiqueta}.json`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, destino)} (updatedAt ${flujo.updatedAt})`);
}

async function escribir(id, flujo, etiqueta) {
  console.log(`verificado ${etiqueta}: ${verificarFlujo(flujo, etiqueta)} nodos compilan`);

  if (process.env.SECO === "1") return;

  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers: CABECERAS,
    body: JSON.stringify({
      name: flujo.name,
      nodes: flujo.nodes,
      connections: flujo.connections,
      settings: flujo.settings ?? {},
    }),
  });

  if (!r.ok) throw new Error(`PUT ${etiqueta} falló: ${r.status} ${await r.text()}`);
  console.log(`${etiqueta} actualizado.`);
}

// ------------------------------------------------------------------ gateway
const gateway = await traer(GATEWAY);
respaldar(gateway, "gateway");

const http = nodo(gateway, "HTTP Request");
if (http.parameters.jsonBody.includes("ANULAR_COMPRA")) {
  throw new Error("El prompt ya conoce ANULAR_COMPRA. No se escribió nada.");
}
http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

const n05 = nodo(gateway, "05 GW");
n05.parameters.jsCode = cambiar(
  n05.parameters.jsCode,
  "    'CORREGIR_VENTA'\n  ]);",
  [
    "    'CORREGIR_VENTA',",
    "",
    "    /*",
    "      Las simétricas de compra: deshacer y corregir un gasto mal cargado.",
    "      Las funciones existen desde agosto y la pantalla las usa; faltaba el",
    "      verbo. Ver la migración v170.",
    "    */",
    "    'ANULAR_COMPRA',",
    "    'CORREGIR_COMPRA'",
    "  ]);",
  ].join("\n"),
  "05 GW/lista blanca",
);

const n06 = nodo(gateway, "06 GW");
n06.parameters.jsCode = cambiar(
  n06.parameters.jsCode,
  "  CORREGIR_VENTA: 'eos-worker-rc1-internal'\n};",
  [
    "  CORREGIR_VENTA: 'eos-worker-rc1-internal',",
    "  ANULAR_COMPRA: 'eos-worker-rc1-internal',",
    "  CORREGIR_COMPRA: 'eos-worker-rc1-internal'",
    "};",
  ].join("\n"),
  "06 GW/paths",
);

// ------------------------------------------------------------------- worker
const worker = await traer(WORKER);
respaldar(worker, "worker");

const w01 = nodo(worker, "01 INT");
w01.parameters.jsCode = cambiar(
  w01.parameters.jsCode,
  "  'CORREGIR_VENTA'\n]);",
  ["  'CORREGIR_VENTA',", "  'ANULAR_COMPRA',", "  'CORREGIR_COMPRA'", "]);"].join("\n"),
  "01 INT/allowlist",
);

const w05 = nodo(worker, "05 INT Respuesta");

w05.parameters.jsCode = cambiar(
  w05.parameters.jsCode,
  "function fraseDeAccion(accion, result) {\n  if (accion === 'CORREGIR_VENTA') return fraseDeCorreccionVenta(result);",
  [
    "/*",
    "  Qué se anuló, con nombre y número: es lo único que permite ver en el",
    "  momento que se anuló la compra equivocada.",
    "*/",
    "function fraseDeAnulacionCompra(result) {",
    "  const r = (result && result.resultado) || {};",
    "",
    "  if (r.ya_estaba) return 'Esa compra ya estaba anulada, así que no toqué nada.';",
    "",
    "  const items = Array.isArray(r.items) ? r.items : [];",
    "",
    "  const que = items.length",
    "    ? items.map(function (i) { return i.cantidad + ' ' + i.concepto; }).join(', ')",
    "    : 'la compra';",
    "",
    "  const frases = ['Anulé la compra del ' + (r.fecha || 'día') + ': ' + que + ', \\u20B2 ' + plata(r.total) + '.'];",
    "",
    "  if (r.productos_retirados > 0) {",
    "    frases.push(",
    "      r.productos_retirados === 1",
    "        ? 'Le saqué el stock al producto.'",
    "        : 'Les saqué el stock a los ' + r.productos_retirados + ' productos.'",
    "    );",
    "  }",
    "",
    "  if (r.movimiento_borrado) frases.push('El gasto salió del panel del mes.');",
    "",
    "  if (r.candidatos > 1) {",
    "    frases.push('Era la más reciente de ' + r.candidatos + ' que coincidían. Si no era esa, decímelo y la vuelvo a cargar.');",
    "  }",
    "",
    "  return frases.join(' ');",
    "}",
    "",
    "/*",
    "  El antes y el después, que es toda la seguridad de este verbo: 'de 2 a 3'",
    "  permite ver en el momento que se corrigió el número equivocado.",
    "*/",
    "function fraseDeCorreccionCompra(result) {",
    "  const r = (result && result.resultado) || {};",
    "",
    "  if (r.ya_estaba) return 'Esa corrección ya estaba hecha, así que no toqué nada.';",
    "",
    "  const antes = r.antes || {};",
    "  const despues = r.despues || {};",
    "  const que = despues.concepto || antes.concepto || 'el concepto';",
    "",
    "  const frases = [];",
    "",
    "  if (antes.cantidad !== despues.cantidad) {",
    "    frases.push('Corregí ' + que + ': de ' + antes.cantidad + ' a ' + despues.cantidad + '.');",
    "  }",
    "",
    "  if (antes.precio_unitario !== despues.precio_unitario) {",
    "    frases.push(",
    "      'El precio pasó de \\u20B2 ' + plata(antes.precio_unitario) +",
    "      ' a \\u20B2 ' + plata(despues.precio_unitario) + '.'",
    "    );",
    "  }",
    "",
    "  if (!frases.length) frases.push('Corregí ' + que + '.');",
    "",
    "  if (r.total_anterior != null && r.total != null && r.total_anterior !== r.total) {",
    "    frases.push('La compra quedó en \\u20B2 ' + plata(r.total) + ', antes \\u20B2 ' + plata(r.total_anterior) + '.');",
    "  }",
    "",
    "  if (r.candidatos > 1) {",
    "    frases.push('Era la más reciente de ' + r.candidatos + ' que coincidían. Si no era esa, decímelo.');",
    "  }",
    "",
    "  return frases.join(' ');",
    "}",
    "",
    "function fraseDeAccion(accion, result) {",
    "  if (accion === 'CORREGIR_COMPRA') return fraseDeCorreccionCompra(result);",
    "  if (accion === 'ANULAR_COMPRA') return fraseDeAnulacionCompra(result);",
    "  if (accion === 'CORREGIR_VENTA') return fraseDeCorreccionVenta(result);",
  ].join("\n"),
  "05 INT/frases de compra",
);

await escribir(GATEWAY, gateway, "gateway");
await escribir(WORKER, worker, "worker");

if (process.env.SECO === "1") {
  console.log("SECO=1: los cinco anclajes encajaron y los dos workflows compilan. No se escribió nada.");
} else {
  console.log("Seguir con: node n8n/exportar.mjs && node n8n/parches/sincronizar-prompt.mjs");
}
