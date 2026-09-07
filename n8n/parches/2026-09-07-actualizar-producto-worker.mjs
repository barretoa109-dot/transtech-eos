/**
 * La cuarta punta de ACTUALIZAR_PRODUCTO, y su frase.
 *
 *     node n8n/parches/2026-09-07-actualizar-producto-worker.mjs
 *
 * ============================================================
 * 1) LA LISTA BLANCA DEL WORKER
 * ============================================================
 *
 * `01 INT Preparar` tiene su propia lista y rechaza lo que no esté en ella.
 * Es la punta que se olvidó dos veces —el 31 de agosto con las tres del
 * negocio y el 7 de septiembre con CREAR_PRODUCTO— y la peor de las cuatro,
 * porque no da error visible: el gateway llama, espera unos segundos, recibe
 * `{}`, y desde el chat parece que la acción se ejecutó.
 *
 * ============================================================
 * 2) LA FRASE, QUE AHORA SE ARMA EN UN SOLO LUGAR
 * ============================================================
 *
 * Con CREAR_PRODUCTO la frase dejó de ser un texto fijo por acción y pasó a
 * armarse con el resultado. Estaba escrito como un ternario dentro de otro:
 *
 *     prep.accion === 'CREAR_PRODUCTO' ? fraseDeProductos(result) : (doneText…)
 *
 * Con la segunda acción que necesita lo mismo eso ya no escala. Queda un
 * `fraseDeAccion(accion, result)` que despacha, y `doneText` como respaldo
 * para las que no tienen nada que contar además de que se hicieron.
 *
 * ACTUALIZAR_PRODUCTO tiene MUCHO que contar: cambiar un precio de 165.000 a
 * 200.000 y decir "listo" deja a la persona sin saber si entendió 200.000 o
 * 20.000. La frase lleva el antes y el después de cada campo, que es lo que
 * la v133 devuelve justamente para esto.
 */

import fs from "node:fs";
import path from "node:path";

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

const BLANCA_VIEJA = `  'CREAR_PRODUCTO'
]);`;

const BLANCA_NUEVA = `  'CREAR_PRODUCTO',

  /*
    Poner el costo y corregir el precio de lo que ya existe. Quinta acción del
    negocio, cuarta vez que se pasa por esta lista, y la tercera vez que hay
    que acordarse de que existe.
  */
  'ACTUALIZAR_PRODUCTO'
]);`;

// El comparador tiene que ser el texto exacto que dejó el parche anterior.
const RESPUESTA_VIEJA = `    respuesta: success
      ? (prep.accion === 'CREAR_PRODUCTO'
          ? fraseDeProductos(result)
          : (doneText[prep.accion] || 'La acción quedó completada.'))
      : motivoDelError(result)`;

const RESPUESTA_NUEVA = `    respuesta: success
      ? (fraseDeAccion(prep.accion, result) || doneText[prep.accion] || 'La acción quedó completada.')
      : motivoDelError(result)`;

const AYUDANTE = `
/*
  Guaraníes como los escribe alguien de acá: punto para los miles, coma para
  los decimales, y sin decimales cuando no los hay.

  Los costos que salen de una cuenta con envío llegan con medio guaraní
  (122.414,5) y redondearlos en la confirmación mostraría un número distinto
  del que quedó guardado.
*/
function plata(n) {
  const x = Number(n);
  if (!isFinite(x)) return String(n);

  const negativo = x < 0;
  const abs = Math.abs(x);
  const entero = Math.floor(abs);

  let texto = String(entero).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');

  const decimal = Math.round((abs - entero) * 100);
  if (decimal > 0) {
    let d = String(decimal);
    if (d.length === 1) d = '0' + d;
    if (d.charAt(1) === '0') d = d.charAt(0);
    texto = texto + ',' + d;
  }

  return (negativo ? '-' : '') + texto;
}

/*
  Qué cambió, campo por campo, con el antes y el después.

  "Actualicé el producto" no sirve: cambiar un precio de 165.000 a 200.000 y
  decir "listo" deja a la persona sin saber si el sistema entendió 200.000 o
  20.000, que es exactamente el error que hay que poder ver enseguida. La
  v133 devuelve el antes justamente para poder escribirlo.
*/
function fraseDeCambios(result) {
  const r = (result && result.resultado) || {};
  const hechos = Array.isArray(r.actualizados) ? r.actualizados : [];
  const faltan = Array.isArray(r.no_encontrados) ? r.no_encontrados : [];
  const iguales = Array.isArray(r.sin_cambios) ? r.sin_cambios : [];

  const etiqueta = { precio_venta: 'precio', costo: 'costo', iva: 'IVA' };

  const partes = [];

  for (const p of hechos) {
    const cambios = p.cambios || {};
    const trozos = [];

    for (const campo of ['precio_venta', 'costo', 'iva']) {
      const c = cambios[campo];
      if (!c) continue;

      const antes = c.antes === null || c.antes === undefined;
      const valor = campo === 'iva' ? c.despues + '%' : plata(c.despues);

      trozos.push(
        antes
          ? etiqueta[campo] + ' ' + valor + ' (no tenía)'
          : etiqueta[campo] + ' de ' + (campo === 'iva' ? c.antes + '%' : plata(c.antes)) + ' a ' + valor
      );
    }

    if (trozos.length) partes.push('\\u201C' + p.nombre + '\\u201D: ' + trozos.join(', '));
  }

  const frases = [];

  if (partes.length === 1) frases.push('Actualicé ' + partes[0] + '.');
  else if (partes.length > 1) frases.push('Actualicé ' + partes.length + ' productos. ' + partes.join('. ') + '.');

  // Acá y no al final: después del aviso de que un producto no estaba, "lo
  // ves en Negocio > Productos" se lee como si hablara de ese.
  if (partes.length) frases.push('Lo ves en Negocio > Productos.');

  if (iguales.length === 1) frases.push('\\u201C' + iguales[0] + '\\u201D ya estaba así.');
  else if (iguales.length > 1) frases.push(iguales.length + ' ya estaban así.');

  if (faltan.length) {
    frases.push(
      (faltan.length === 1 ? 'No encontré \\u201C' + faltan[0] + '\\u201D' : 'No encontré ' + faltan.length + ' de los que nombraste') +
      ' en tu catálogo: pasame el precio de venta y te lo cargo.'
    );
  }

  if (!frases.length) return 'No quedó nada para actualizar.';

  return frases.join(' ');
}

/*
  La frase la arma la acción que sabe qué pasó; las que no tienen nada que
  contar además de que se hicieron caen en \`doneText\`.
*/
function fraseDeAccion(accion, result) {
  if (accion === 'CREAR_PRODUCTO') return fraseDeProductos(result);
  if (accion === 'ACTUALIZAR_PRODUCTO') return fraseDeCambios(result);
  return null;
}
`;

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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'ACTUALIZAR_PRODUCTO'")) {
    nuevo = nuevo.replace(BLANCA_VIEJA, BLANCA_NUEVA);
  }

  if (nuevo.includes(RESPUESTA_VIEJA)) {
    if (nuevo.includes("fraseDeCambios")) {
      throw new Error(`El nodo "${nodo.name}" ya está parcheado. No se escribió nada.`);
    }
    nuevo = AYUDANTE + nuevo.replace(RESPUESTA_VIEJA, RESPUESTA_NUEVA);
  }

  if (nuevo !== codigo) {
    nodo.parameters.jsCode = nuevo;
    tocados += 1;
    console.log(`  ${nodo.name}: parcheado`);
  }
}

if (tocados !== 2) {
  throw new Error(`Esperaba tocar 2 nodos (lista blanca y respuesta) y toqué ${tocados}. No se escribió nada.`);
}

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
