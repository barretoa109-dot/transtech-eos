/**
 * La cuarta punta de REGISTRAR_COBRO y REGISTRAR_PAGO_COMPRA, y su frase.
 *
 *     node n8n/parches/2026-09-09-cobro-y-pago-worker.mjs
 *
 * La frase tiene que decir A QUIÉN, CUÁNTO, CONTRA QUÉ FACTURAS y CUÁNTO
 * QUEDA. El último es el que más importa: un cobro parcial que se anuncia
 * como "listo" hace creer que la cuenta quedó saldada, y una factura que se
 * cree cobrada es una factura que la persona deja de reclamar.
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

const BLANCA_VIEJA = `  'DECLARAR_SALDO'
]);`;

const BLANCA_NUEVA = `  'DECLARAR_SALDO',

  /*
    Cobrar una venta y pagar una compra: 4 puntos, como pagar una cuota. Son
    las dos acciones del negocio que escriben en DOS lados a la vez —bajan el
    saldo del documento y dejan el movimiento financiero— y un cobro mal
    cargado deja una factura como cobrada, que la persona deja de reclamar.
  */
  'REGISTRAR_COBRO',
  'REGISTRAR_PAGO_COMPRA'
]);`;

const DESPACHO_VIEJO = `  if (accion === 'DECLARAR_SALDO') return fraseDeSaldo(result);
  return null;
}`;

const DESPACHO_NUEVO = `  if (accion === 'DECLARAR_SALDO') return fraseDeSaldo(result);
  if (accion === 'REGISTRAR_COBRO' || accion === 'REGISTRAR_PAGO_COMPRA') {
    return fraseDeCartera(result);
  }
  return null;
}

/*
  La frase dice A QUIÉN, CUÁNTO, CONTRA QUÉ y CUÁNTO QUEDA.

  Lo que queda es lo que más importa. Un cobro parcial anunciado como "listo"
  hace creer que la cuenta quedó saldada, y una factura que se cree cobrada es
  una factura que nadie vuelve a reclamar. Por eso el resto va siempre, aunque
  sea cero — decir "no te debe más nada" es tan útil como decir cuánto falta.
*/
function diaMes(iso) {
  if (!iso || iso.length < 10) return String(iso || '');
  return iso.slice(8, 10) + '/' + iso.slice(5, 7);
}

function fraseDeCartera(result) {
  const r = (result && result.resultado) || {};
  if (!r.contacto) return null;

  const signo = signoDe(r.moneda);
  const docs = Array.isArray(r.documentos) ? r.documentos : [];
  const cerrados = Number(r.cerrados) || 0;
  const resta = Number(r.resta) || 0;

  const frases = [
    (r.es_venta ? 'Cobré ' : 'Pagué ') + signo + plata(r.aplicado) + ' a ' + r.contacto + '.'
  ];

  if (docs.length === 1) {
    frases.push(
      cerrados === 1
        ? 'Saldó la factura del ' + diaMes(docs[0].fecha) + '.'
        : 'Va a cuenta de la del ' + diaMes(docs[0].fecha) + '.'
    );
  } else if (docs.length > 1) {
    frases.push(
      cerrados > 0
        ? 'Cerró ' + cerrados + ' facturas' + (cerrados < docs.length
            ? ' y el resto quedó a cuenta de la del ' + diaMes(docs[docs.length - 1].fecha) + '.'
            : '.')
        : 'Repartido entre ' + docs.length + ' facturas.'
    );
  }

  frases.push(
    resta > 0
      ? (r.es_venta ? 'Le quedan ' : 'Te quedan ') + signo + plata(resta) + '.'
      : (r.es_venta ? 'No te debe más nada.' : 'No le debés más nada.')
  );

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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'REGISTRAR_COBRO'")) {
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
