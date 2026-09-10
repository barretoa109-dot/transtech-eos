/**
 * CORREGIR_VENTA, en los cuatro lugares de n8n.
 *
 *     SECO=1 node n8n/parches/2026-09-10-corregir-venta.mjs   (prueba)
 *     node n8n/parches/2026-09-10-corregir-venta.mjs          (escribe)
 *
 * gateway: el prompt (nodo HTTP Request), la lista blanca del 05 y la ruta
 *          del 06.
 * worker:  el allowlist del 01 INT y la frase del 05 INT.
 *
 * El porqué está en `cambios-corregir-venta.mjs` y en la migración v162.
 *
 * Después de aplicar:
 *
 *     node n8n/exportar.mjs
 *     node n8n/parches/sincronizar-prompt.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar } from "./cambios-corregir-venta.mjs";

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
if (http.parameters.jsonBody.includes("CORREGIR_VENTA")) {
  throw new Error("El prompt ya conoce CORREGIR_VENTA. No se escribió nada.");
}
http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

const n05 = nodo(gateway, "05 GW");
n05.parameters.jsCode = cambiar(
  n05.parameters.jsCode,
  "    'ANULAR_VENTA'\n  ]);",
  [
    "    'ANULAR_VENTA',",
    "",
    "    /*",
    "      Corregir un renglón de una venta. Es el error más frecuente de todos",
    "      —un número hablado que se entendió mal— y hasta hoy obligaba a anular",
    "      y redictar la venta entera.",
    "    */",
    "    'CORREGIR_VENTA'",
    "  ]);",
  ].join("\n"),
  "05 GW/lista blanca",
);

const n06 = nodo(gateway, "06 GW");
n06.parameters.jsCode = cambiar(
  n06.parameters.jsCode,
  "  ANULAR_VENTA: 'eos-worker-rc1-internal'\n};",
  [
    "  ANULAR_VENTA: 'eos-worker-rc1-internal',",
    "  CORREGIR_VENTA: 'eos-worker-rc1-internal'",
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
  "  'ANULAR_VENTA'\n]);",
  ["  'ANULAR_VENTA',", "  'CORREGIR_VENTA'", "]);"].join("\n"),
  "01 INT/allowlist",
);

const w05 = nodo(worker, "05 INT Respuesta");

w05.parameters.jsCode = cambiar(
  w05.parameters.jsCode,
  "function fraseDeAccion(accion, result) {",
  [
    "/*",
    "  El antes y el después, que es toda la seguridad de este verbo.",
    "",
    "  EOS elige cuál venta y cuál renglón. 'Listo, corregido' no permite ver",
    "  que corrigió el número equivocado; 'de 30 a 3' sí, y en el momento.",
    "*/",
    "function fraseDeCorreccionVenta(result) {",
    "  const r = (result && result.resultado) || {};",
    "",
    "  if (r.ya_estaba) return 'Esa corrección ya estaba hecha, así que no toqué nada.';",
    "",
    "  const antes = r.antes || {};",
    "  const despues = r.despues || {};",
    "  const que = despues.producto || antes.producto || 'el producto';",
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
    "    frases.push('La venta quedó en \\u20B2 ' + plata(r.total) + ', antes \\u20B2 ' + plata(r.total_anterior) + '.');",
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
    "  if (accion === 'CORREGIR_VENTA') return fraseDeCorreccionVenta(result);",
  ].join("\n"),
  "05 INT/fraseDeCorreccionVenta",
);

await escribir(GATEWAY, gateway, "gateway");
await escribir(WORKER, worker, "worker");

if (process.env.SECO === "1") {
  console.log("SECO=1: los cinco anclajes encajaron y los dos workflows compilan. No se escribió nada.");
} else {
  console.log("Seguir con: node n8n/exportar.mjs && node n8n/parches/sincronizar-prompt.mjs");
}
