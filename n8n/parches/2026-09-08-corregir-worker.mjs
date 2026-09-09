/**
 * La cuarta punta de CORREGIR_MOVIMIENTO, y su frase.
 *
 *     node n8n/parches/2026-09-08-corregir-worker.mjs
 *
 * La frase tiene que decir QUÉ movimiento tocó y qué tenía antes. Es lo único
 * que le permite a la persona darse cuenta de que EOS corrigió el equivocado —
 * "nafta" coincide con varias filas y se toma la más reciente.
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

const BLANCA_VIEJA = `  'REGISTRAR_DEUDA',
  'REGISTRAR_PAGO_DEUDA'
]);`;

const BLANCA_NUEVA = `  'REGISTRAR_DEUDA',
  'REGISTRAR_PAGO_DEUDA',

  /*
    Corregir lo que quedó mal anotado. Cuesta 1 punto, menos que anotarlo: casi
    siempre existe porque EOS entendió mal un monto, y cobrarle a la persona el
    mismo presupuesto por el error del sistema que por su propio trabajo la
    deja sin cupo justo cuando está arreglando algo que no rompió ella.
  */
  'CORREGIR_MOVIMIENTO'
]);`;

const DESPACHO_VIEJO = `  if (accion === 'REGISTRAR_PAGO_DEUDA') return fraseDePagoDeuda(result);
  return null;
}`;

const DESPACHO_NUEVO = `  if (accion === 'REGISTRAR_PAGO_DEUDA') return fraseDePagoDeuda(result);
  if (accion === 'CORREGIR_MOVIMIENTO') return fraseDeCorreccion(result);
  return null;
}

/*
  La frase dice QUÉ movimiento tocó y qué tenía antes.

  Es lo único que le permite a la persona darse cuenta de que EOS corrigió el
  equivocado: 'nafta' coincide con varias filas y se toma la más reciente. Sin
  el antes y el cuál, 'listo' sobre la fila equivocada pasa desapercibido.
*/
function fraseDeCorreccion(result) {
  const r = (result && result.resultado) || {};
  const antes = r.antes || {};
  const despues = r.despues || {};

  if (!antes.descripcion && !despues.descripcion) return 'No encontré ese movimiento.';

  const frases = [];
  const que = despues.descripcion || antes.descripcion;

  if (antes.monto !== despues.monto) {
    frases.push('Corregí ' + que + ' del ' + antes.fecha + ': de \u20B2 ' + plata(antes.monto) +
      ' a \u20B2 ' + plata(despues.monto) + '.');
  } else if (antes.fecha !== despues.fecha) {
    frases.push('Moví ' + que + ' del ' + antes.fecha + ' al ' + despues.fecha + '.');
  } else {
    frases.push('Corregí el movimiento del ' + antes.fecha + ': ahora dice ' + que + '.');
  }

  if (Number(r.coincidencias) > 1) {
    frases.push('Coincidían ' + r.coincidencias + ' y tomé el más reciente; si era otro, decímelo.');
  }

  return frases.join(' ');
}`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(
  path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`),
  JSON.stringify(flujo, null, 2),
);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string") continue;

  let nuevo = codigo;

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'CORREGIR_MOVIMIENTO'")) {
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

if (tocados !== 2) throw new Error(`Esperaba 2 nodos y toqué ${tocados}. No se escribió nada.`);

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
console.log(`worker actualizado (${tocados} nodos).`);
