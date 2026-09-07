/**
 * La cuarta punta de REGISTRAR_COMPRA y REGISTRAR_GASTO_FIJO, y sus frases.
 *
 *     node n8n/parches/2026-09-07-registrar-compra-worker.mjs
 *
 * ============================================================
 * 1) LA LISTA BLANCA DEL WORKER
 * ============================================================
 *
 * `01 INT Preparar` rechaza lo que no esté en su propia lista. Es la punta
 * que se olvidó tres veces —el 31 de agosto, y dos el 7 de septiembre— y la
 * peor de las cuatro, porque no da error visible: el gateway llama, espera, y
 * recibe `{}`.
 *
 * ============================================================
 * 2) LAS FRASES
 * ============================================================
 *
 * La compra tiene que decir el TOTAL. Es lo único que la persona puede
 * verificar de un vistazo contra lo que dictó, y en este caso el usuario ya
 * había visto a EOS sumar ₲ 3.388.000 en la conversación: si la confirmación
 * dice otro número, se entera ahí y no dentro de un mes.
 *
 * También dice qué conceptos NO están en el catálogo, porque de eso depende
 * si la compra movió stock o solamente plata. Sin esa línea, alguien que
 * compró seis lechones se queda esperando que el inventario los muestre.
 *
 * El gasto fijo tiene que decir la CONVERSIÓN. "750.000 cada 15 días" se
 * guarda como 1.500.000 por mes, y ese número aparece después en el
 * pronóstico de caja: si la respuesta no explica de dónde salió, la única
 * lectura posible es que el sistema se equivocó al doble.
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

const BLANCA_VIEJA = `  'ACTUALIZAR_PRODUCTO'
]);`;

const BLANCA_NUEVA = `  'ACTUALIZAR_PRODUCTO',

  /*
    La plata que sale y la que se va a repetir. Sexta y séptima acción del
    negocio, y cuarta vez que hay que acordarse de esta lista.
  */
  'REGISTRAR_COMPRA',
  'REGISTRAR_GASTO_FIJO'
]);`;

const DESPACHO_VIEJO = `function fraseDeAccion(accion, result) {
  if (accion === 'CREAR_PRODUCTO') return fraseDeProductos(result);
  if (accion === 'ACTUALIZAR_PRODUCTO') return fraseDeCambios(result);
  return null;
}`;

const DESPACHO_NUEVO = `/*
  La compra dice el TOTAL, que es lo único verificable de un vistazo contra lo
  que la persona dictó, y dice qué conceptos NO están en el catálogo, porque
  de eso depende si movió stock o solamente plata.
*/
function fraseDeCompra(result) {
  const r = (result && result.resultado) || {};
  const items = Array.isArray(r.compra) ? r.compra : [];
  const fuera = Array.isArray(r.sin_catalogo) ? r.sin_catalogo : [];
  const total = r.total_compra;

  if (!items.length) return 'No quedó ningún concepto para registrar.';

  const frases = [];

  frases.push(
    items.length === 1
      ? 'Registré la compra de ' + items[0].concepto + ' por \\u20B2 ' + plata(total) + '.'
      : 'Registré una compra de ' + items.length + ' conceptos por \\u20B2 ' + plata(total) + ' en total.'
  );

  frases.push('La ves en Negocio > Compras, y el gasto ya está en el panel financiero.');

  const dentro = items.filter(function (x) { return x.en_catalogo; });
  if (dentro.length) {
    frases.push(
      dentro.length === 1
        ? 'A \\u201C' + dentro[0].concepto + '\\u201D le sumé el stock y le actualicé el costo.'
        : 'A ' + dentro.length + ' de ellos les sumé stock y les actualicé el costo.'
    );
  }

  if (fuera.length) {
    frases.push(
      (fuera.length === 1
        ? '\\u201C' + fuera[0] + '\\u201D no está en tu catálogo'
        : fuera.length + ' de esos conceptos no están en tu catálogo') +
      ', así que quedaron como gasto y no mueven inventario. Si querés que lleven stock, pasame su precio de venta y los cargo.'
    );
  }

  if (r.proveedor && !r.proveedor.agendado) {
    frases.push('No encontré a \\u201C' + r.proveedor.nombre + '\\u201D en tus contactos, así que la compra quedó sin proveedor.');
  }

  return frases.join(' ');
}

/*
  El fijo dice la CONVERSIÓN. "750.000 cada 15 días" se guarda como 1.500.000
  por mes y ese número sale después en el pronóstico de caja: sin explicar de
  dónde salió, la única lectura posible es que el sistema se equivocó al doble.
*/
function fraseDeFijos(result) {
  const r = (result && result.resultado) || {};
  const fijos = Array.isArray(r.fijos) ? r.fijos : [];

  if (!fijos.length) return 'No quedó ningún gasto fijo declarado.';

  const partes = fijos.map(function (f) {
    const base = f.descripcion + ': \\u20B2 ' + plata(f.monto_mensual) + ' por mes';
    return f.convertido
      ? base + ' (\\u20B2 ' + plata(f.monto_original) + ' ' + f.frecuencia + ')'
      : base;
  });

  const dias = fijos.map(function (f) { return f.dia_del_mes; });
  const mismoDia = dias.every(function (d) { return d === dias[0]; });

  return (
    (fijos.length === 1 ? 'Anoté ' : 'Anoté ' + fijos.length + ' fijos: ') +
    partes.join('; ') + '. ' +
    'Lo cuento ' + (mismoDia ? 'el día ' + dias[0] : 'en el día que registré cada uno') +
    ' de cada mes; si es otro, cambialo en Gastos.'
  );
}

function fraseDeAccion(accion, result) {
  if (accion === 'CREAR_PRODUCTO') return fraseDeProductos(result);
  if (accion === 'ACTUALIZAR_PRODUCTO') return fraseDeCambios(result);
  if (accion === 'REGISTRAR_COMPRA') return fraseDeCompra(result);
  if (accion === 'REGISTRAR_GASTO_FIJO') return fraseDeFijos(result);
  return null;
}`;

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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'REGISTRAR_COMPRA'")) {
    nuevo = nuevo.replace(BLANCA_VIEJA, BLANCA_NUEVA);
  }

  if (nuevo.includes(DESPACHO_VIEJO)) {
    nuevo = nuevo.replace(DESPACHO_VIEJO, DESPACHO_NUEVO);
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

// Antes de escribir: que compile. Un parche que deja el workflow roto tira
// el chat entero y n8n acepta el PUT sin decir nada.
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
console.log(`workflow actualizado (${tocados} nodos). Reexportar con: node n8n/exportar.mjs worker`);
