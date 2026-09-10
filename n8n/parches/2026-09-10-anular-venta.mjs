/**
 * ANULAR_VENTA, en los cuatro lugares de n8n.
 *
 *     SECO=1 node n8n/parches/2026-09-10-anular-venta.mjs   (prueba)
 *     node n8n/parches/2026-09-10-anular-venta.mjs          (escribe)
 *
 * Toca los DOS workflows:
 *
 *   gateway: el prompt (nodo HTTP Request), la lista blanca del nodo 05 y la
 *            ruta del nodo 06.
 *   worker:  el allowlist del nodo 01 INT y la frase del nodo 05 INT.
 *
 * El porqué está en `cambios-anular-venta.mjs` y en la migración v159. En una
 * línea: `eos_erp_anular_venta` está en la base desde el 27 de agosto y no
 * había forma de llegar a ella hablando.
 *
 * Después de aplicar, en este orden:
 *
 *     node n8n/exportar.mjs
 *     node n8n/parches/sincronizar-prompt.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";
import { aplicar } from "./cambios-anular-venta.mjs";

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
if (http.parameters.jsonBody.includes("ANULAR_VENTA")) {
  throw new Error("El prompt ya conoce ANULAR_VENTA. No se escribió nada.");
}
http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

const n05 = nodo(gateway, "05 GW");
n05.parameters.jsCode = cambiar(
  n05.parameters.jsCode,
  "    'REGISTRAR_OPORTUNIDAD'\n  ]);",
  [
    "    'REGISTRAR_OPORTUNIDAD',",
    "",
    "    /*",
    "      Deshacer una venta. La función está en la base desde el 27 de agosto",
    "      y no tenía verbo: quien cargaba mal una venta por chat tenía que ir a",
    "      la pantalla a anularla a mano.",
    "    */",
    "    'ANULAR_VENTA'",
    "  ]);",
  ].join("\n"),
  "05 GW/lista blanca",
);

const n06 = nodo(gateway, "06 GW");
n06.parameters.jsCode = cambiar(
  n06.parameters.jsCode,
  "  REGISTRAR_OPORTUNIDAD: 'eos-worker-rc1-internal'\n};",
  [
    "  REGISTRAR_OPORTUNIDAD: 'eos-worker-rc1-internal',",
    "",
    "  /*",
    "    Anular va por el mismo camino interno: deja un efecto durable, igual",
    "    que las demás. Lo que la distingue es que el efecto es sobre filas que",
    "    ya existían — la venta, el stock y el movimiento de plata — y eso lo",
    "    resuelve el ejecutor, no la ruta.",
    "  */",
    "  ANULAR_VENTA: 'eos-worker-rc1-internal'",
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
  "  'REGISTRAR_OPORTUNIDAD'\n]);",
  [
    "  'REGISTRAR_OPORTUNIDAD',",
    "",
    "  /*",
    "    Anular una venta. Es el quinto lugar donde hay que darla de alta, y el",
    "    que ya costó dos semanas en agosto: si falta acá, el worker la rechaza",
    "    ANTES de pedir autorización y no queda ni una fila que auditar.",
    "  */",
    "  'ANULAR_VENTA'",
    "]);",
  ].join("\n"),
  "01 INT/allowlist",
);

const w05 = nodo(worker, "05 INT Respuesta");

w05.parameters.jsCode = cambiar(
  w05.parameters.jsCode,
  "function fraseDeAccion(accion, result) {",
  [
    "/*",
    "  Qué se anuló, con nombre y número.",
    "",
    "  Es la parte que hace segura a esta acción. EOS elige cuál venta anular",
    "  —la más reciente que coincida— y esa elección puede estar mal; decir",
    "  'listo, anulada' sin más deja el error invisible hasta que alguien mira",
    "  el stock. Con la fecha, el total y los productos, se ve en el momento.",
    "*/",
    "function fraseDeAnulacion(result) {",
    "  const r = (result && result.resultado) || {};",
    "",
    "  if (r.ya_estaba) return 'Esa venta ya estaba anulada, así que no toqué nada.';",
    "",
    "  const items = Array.isArray(r.items) ? r.items : [];",
    "",
    "  const que = items.length",
    "    ? items.map(function (i) { return i.cantidad + ' ' + i.producto; }).join(', ')",
    "    : 'la venta';",
    "",
    "  const frases = ['Anulé la venta del ' + (r.fecha || 'día') + ': ' + que + ', \\u20B2 ' + plata(r.total) + '.'];",
    "",
    "  if (r.productos_devueltos > 0) {",
    "    frases.push(",
    "      r.productos_devueltos === 1",
    "        ? 'Le devolví el stock al producto.'",
    "        : 'Les devolví el stock a los ' + r.productos_devueltos + ' productos.'",
    "    );",
    "  }",
    "",
    "  if (r.movimiento_borrado) frases.push('El ingreso salió del panel del mes.');",
    "",
    "  // Si eligió entre varias, se dice: es lo que permite corregir la",
    "  // elección antes de que el error quede.",
    "  if (r.candidatos > 1) {",
    "    frases.push('Era la más reciente de ' + r.candidatos + ' que coincidían. Si no era esa, decímelo y la vuelvo a cargar.');",
    "  }",
    "",
    "  return frases.join(' ');",
    "}",
    "",
    "function fraseDeAccion(accion, result) {",
    "  if (accion === 'ANULAR_VENTA') return fraseDeAnulacion(result);",
  ].join("\n"),
  "05 INT/fraseDeAnulacion",
);

await escribir(GATEWAY, gateway, "gateway");
await escribir(WORKER, worker, "worker");

if (process.env.SECO === "1") {
  console.log("SECO=1: los cinco anclajes encajaron y los dos workflows compilan. No se escribió nada.");
} else {
  console.log("Seguir con: node n8n/exportar.mjs && node n8n/parches/sincronizar-prompt.mjs");
}
