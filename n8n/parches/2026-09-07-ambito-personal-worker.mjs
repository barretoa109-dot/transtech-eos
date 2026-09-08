/**
 * La cuarta punta de REGISTRAR_MOVIMIENTO_PERSONAL, y su frase.
 *
 *     node n8n/parches/2026-09-07-ambito-personal-worker.mjs
 *
 * ============================================================
 * LA FRASE TIENE QUE DECIR DÓNDE QUEDÓ
 * ============================================================
 *
 * Es lo único distinto de esta acción respecto de las del negocio, y es todo
 * el punto: ahora hay DOS lugares donde puede terminar la plata, y el usuario
 * necesita saber a cuál fue sin ir a buscarlo. Si EOS anota en Personal algo
 * que era del negocio, la única forma de enterarse en el momento es que la
 * confirmación lo diga.
 *
 * Por eso la frase nombra la sección —"en Personal"— y no solamente el monto.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "iUMdg9fhAg54irmy";

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

const BLANCA_VIEJA = `  'REGISTRAR_COMPRA',
  'REGISTRAR_GASTO_FIJO'
]);`;

const BLANCA_NUEVA = `  'REGISTRAR_COMPRA',
  'REGISTRAR_GASTO_FIJO',

  /*
    La plata de la persona, que desde la v136 vive separada de la del negocio.
  */
  'REGISTRAR_MOVIMIENTO_PERSONAL'
]);`;

const DESPACHO_VIEJO = `function fraseDeAccion(accion, result) {
  if (accion === 'CREAR_PRODUCTO') return fraseDeProductos(result);
  if (accion === 'ACTUALIZAR_PRODUCTO') return fraseDeCambios(result);
  if (accion === 'REGISTRAR_COMPRA') return fraseDeCompra(result);
  if (accion === 'REGISTRAR_GASTO_FIJO') return fraseDeFijos(result);
  return null;
}`;

const DESPACHO_NUEVO = `/*
  Dice DÓNDE quedó, no solo cuánto.

  Desde la v136 hay dos lugares posibles y son incompatibles: Negocios y
  Personal. Si EOS entendió mal de cuál era, la confirmación es la única
  oportunidad de que el usuario lo vea en el momento — después habría que
  encontrarlo revisando un panel que no cuadra.
*/
function fraseDePersonal(result) {
  const r = (result && result.resultado) || {};
  const ms = Array.isArray(r.movimientos) ? r.movimientos : [];

  if (!ms.length) return 'No quedó nada anotado.';

  const partes = ms.map(function (m) {
    const signo = m.tipo === 'ingreso' ? 'Entró' : 'Salió';
    return signo + ' \\u20B2 ' + plata(m.monto) + ' \\u2014 ' + m.descripcion;
  });

  const cierre = ms.length === 1
    ? 'Lo anoté en Personal.'
    : 'Los anoté en Personal.';

  return partes.join('. ') + '. ' + cierre + ' No toca las cuentas del negocio.';
}

function fraseDeAccion(accion, result) {
  if (accion === 'CREAR_PRODUCTO') return fraseDeProductos(result);
  if (accion === 'ACTUALIZAR_PRODUCTO') return fraseDeCambios(result);
  if (accion === 'REGISTRAR_COMPRA') return fraseDeCompra(result);
  if (accion === 'REGISTRAR_GASTO_FIJO') return fraseDeFijos(result);
  if (accion === 'REGISTRAR_MOVIMIENTO_PERSONAL') return fraseDePersonal(result);
  return null;
}`;

// El fijo ahora sabe de quién es, y la frase tiene que decirlo.
const FIJO_VIEJO = `    const base = f.descripcion + ': \\u20B2 ' + plata(f.monto_mensual) + ' por mes';`;
const FIJO_NUEVO = `    const donde = f.ambito === 'negocio' ? ' (del negocio)' : '';
    const base = f.descripcion + donde + ': \\u20B2 ' + plata(f.monto_mensual) + ' por mes';`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string") continue;

  let nuevo = codigo;

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'REGISTRAR_MOVIMIENTO_PERSONAL'")) {
    nuevo = nuevo.replace(BLANCA_VIEJA, BLANCA_NUEVA);
  }

  if (nuevo.includes(DESPACHO_VIEJO)) {
    nuevo = nuevo.replace(DESPACHO_VIEJO, DESPACHO_NUEVO);
  }

  if (nuevo.includes(FIJO_VIEJO)) {
    nuevo = nuevo.replace(FIJO_VIEJO, FIJO_NUEVO);
  }

  if (nuevo !== codigo) {
    nodo.parameters.jsCode = nuevo;
    tocados += 1;
    console.log(`  ${nodo.name}: parcheado`);
  }
}

if (tocados !== 2) {
  throw new Error(`Esperaba tocar 2 nodos y toqué ${tocados}. No se escribió nada.`);
}

console.log(`verificado: ${verificarFlujo(flujo, "worker")} nodos compilan`);

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
console.log(`worker actualizado (${tocados} nodos). Reexportar con: node n8n/exportar.mjs worker`);
