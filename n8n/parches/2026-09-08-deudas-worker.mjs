/**
 * La cuarta punta de las deudas, y sus frases.
 *
 *     node n8n/parches/2026-09-08-deudas-worker.mjs
 *
 * La del pago tiene que decir las DOS cosas que pasaron —el saldo bajó y la
 * plata salió— porque es la única acción del sistema que escribe en dos
 * tablas. Si la confirmación solo dice una, la otra queda como una sorpresa:
 * o el mes tiene un gasto que nadie recuerda, o la deuda no baja nunca.
 *
 * Y cuando la deuda queda saldada, se dice. Es de las pocas veces que este
 * producto tiene una buena noticia para dar.
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

const BLANCA_VIEJA = `  'REGISTRAR_TRANSFERENCIA'
]);`;

const BLANCA_NUEVA = `  'REGISTRAR_TRANSFERENCIA',

  /*
    Las deudas. Declarar una es barato a propósito: a alguien endeudado hay que
    ponerle la menor cantidad de trabas para contarle a EOS cuánto debe.
  */
  'REGISTRAR_DEUDA',
  'REGISTRAR_PAGO_DEUDA'
]);`;

const DESPACHO_VIEJO = `  if (accion === 'REGISTRAR_TRANSFERENCIA') return fraseDeTransferencia(result);
  return null;
}`;

const DESPACHO_NUEVO = `  if (accion === 'REGISTRAR_TRANSFERENCIA') return fraseDeTransferencia(result);
  if (accion === 'REGISTRAR_DEUDA') return fraseDeDeuda(result);
  if (accion === 'REGISTRAR_PAGO_DEUDA') return fraseDePagoDeuda(result);
  return null;
}

/*
  Al declarar una deuda, lo importante es que se vea el número que se guardó y
  qué le falta a EOS para poder ayudar. Una deuda sin cuota no entra en el plan
  de pago: se puede ver, pero no se puede ordenar.
*/
function fraseDeDeuda(result) {
  const r = (result && result.resultado) || {};
  if (!r.acreedor) return 'No quedó registrada la deuda.';

  const cambios = r.cambios || {};
  const frases = [];

  if (r.creada) {
    frases.push('Anoté que le debés \\u20B2 ' + plata(r.saldo) + ' a ' + r.acreedor + '.');
  } else if (cambios.saldo) {
    frases.push('El saldo con ' + r.acreedor + ' pasó de \\u20B2 ' + plata(cambios.saldo.antes) +
      ' a \\u20B2 ' + plata(cambios.saldo.despues) + '.');
  } else if (cambios.cuota) {
    frases.push('La cuota de ' + r.acreedor + ' quedó en \\u20B2 ' + plata(cambios.cuota.despues) + '.');
  } else {
    frases.push('Actualicé la deuda con ' + r.acreedor + '.');
  }

  if (r.cuota) {
    frases.push('Cuota de \\u20B2 ' + plata(r.cuota) + (r.cuota_dia ? ' el ' + r.cuota_dia + ' de cada mes' : '') + '.');
  }

  if (r.sin_cuota) {
    frases.push('Todavía no sé de cuánto es la cuota: sin eso no puedo meterla en el plan de pago del mes.');
  } else {
    frases.push('La ves en Personal, con el orden en que conviene pagar.');
  }

  return frases.join(' ');
}

/*
  El pago escribe en dos tablas y la frase dice las dos: la deuda bajó y la
  plata salió. Si solo dijera una, la otra sería una sorpresa — un gasto que
  nadie recuerda, o una deuda que no baja nunca.
*/
function fraseDePagoDeuda(result) {
  const r = (result && result.resultado) || {};
  if (!r.acreedor) return 'No quedó registrado el pago.';

  const frases = [];

  frases.push('Pagaste \\u20B2 ' + plata(r.pagado) + ' a ' + r.acreedor + '.');

  if (r.saldada) {
    frases.push('Con eso la saldaste: ya no te queda nada con ' + r.acreedor + '.');
  } else {
    frases.push('Te queda \\u20B2 ' + plata(r.saldo_despues) + ', de \\u20B2 ' + plata(r.saldo_antes) + '.');
    if (r.cuotas_totales) {
      frases.push('Vas ' + r.cuotas_pagadas + ' de ' + r.cuotas_totales + ' cuotas.');
    }
  }

  frases.push('Lo conté también como gasto de este mes en Personal.');

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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'REGISTRAR_PAGO_DEUDA'")) {
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
