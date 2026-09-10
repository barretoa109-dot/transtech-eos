/**
 * La cuarta punta de los dos verbos de tarjeta, y sus frases.
 *
 *     node n8n/parches/2026-09-10-tarjetas-worker.mjs
 *
 * Dos cosas que la frase de la compra tiene que decir sí o sí:
 *
 *   1. QUE NO ES UN GASTO DE ESTE MES. Es contraintuitivo —la persona acaba
 *      de gastar— y si EOS no lo dice, va a buscar la compra en su panel del
 *      mes, no la va a encontrar, y va a concluir que no se anotó.
 *
 *   2. SI LA CUOTA LA ESTIMÓ. Con intereses, el total dividido las cuotas es
 *      menos que la cuota real, y una cuota estimada se ve idéntica a una
 *      declarada: sobre ella se decide si se llega a fin de mes.
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

const BLANCA_VIEJA = `  'REGISTRAR_COBRO',
  'REGISTRAR_PAGO_COMPRA'
]);`;

const BLANCA_NUEVA = `  'REGISTRAR_COBRO',
  'REGISTRAR_PAGO_COMPRA',

  /*
    Las tarjetas. Cargar la tarjeta cuesta 1, como declarar un saldo: es la
    persona contándole a EOS un hecho sobre su plata, y el resumen cambia todos
    los meses. La compra en cuotas cuesta 2, porque crea hasta doce
    vencimientos futuros y una duplicada infla el calendario del mes.
  */
  'REGISTRAR_TARJETA',
  'REGISTRAR_COMPRA_TARJETA'
]);`;

const DESPACHO_VIEJO = `  if (accion === 'REGISTRAR_COBRO' || accion === 'REGISTRAR_PAGO_COMPRA') {
    return fraseDeCartera(result);
  }
  return null;
}`;

const DESPACHO_NUEVO = `  if (accion === 'REGISTRAR_COBRO' || accion === 'REGISTRAR_PAGO_COMPRA') {
    return fraseDeCartera(result);
  }
  if (accion === 'REGISTRAR_TARJETA') return fraseDeTarjeta(result);
  if (accion === 'REGISTRAR_COMPRA_TARJETA') return fraseDeCompraTarjeta(result);
  return null;
}

function fraseDeTarjeta(result) {
  const r = (result && result.resultado) || {};
  if (!r.tarjeta) return null;

  const signo = signoDe(r.moneda);
  const frases = [];

  if (r.creada) {
    frases.push('Cargué ' + r.tarjeta + '.');
  }

  /*
    El resumen manda sobre el resto: si la persona acaba de contar cuánto vino,
    lo que quiere ver confirmado es ese número y cuándo hay que pagarlo.
  */
  if (r.pago_total !== null && r.pago_total !== undefined) {
    var linea = 'Resumen: ' + signo + plata(r.pago_total);
    if (r.pago_minimo !== null && r.pago_minimo !== undefined) {
      linea += ', mínimo ' + signo + plata(r.pago_minimo);
    }
    if (r.dia_vencimiento) linea += '. Vence el ' + r.dia_vencimiento;
    frases.push(linea + '.');
  } else if (!r.creada) {
    frases.push('Actualicé ' + r.tarjeta + '.');
  }

  if (r.dia_cierre && r.dia_vencimiento && r.creada) {
    frases.push('Cierra el ' + r.dia_cierre + ' y vence el ' + r.dia_vencimiento + '.');
  }

  /*
    Sin el ciclo no se puede calcular NADA de esta tarjeta: ni cuándo cae la
    cuota, ni si entra en el mes. Decirlo acá cuesta una línea; que la persona
    lo descubra mirando un panel vacío cuesta la confianza.
  */
  if (r.falta_ciclo) {
    frases.push('Me falta qué día cierra y qué día vence para poder calcularte los vencimientos.');
  }

  return frases.join(' ');
}

function fraseDeCompraTarjeta(result) {
  const r = (result && result.resultado) || {};
  if (!r.descripcion) return null;

  const signo = signoDe(r.moneda);
  const cuotas = Number(r.cuotas) || 1;
  const frases = [];

  frases.push(
    cuotas > 1
      ? 'Anoté ' + r.descripcion + ': ' + cuotas + ' cuotas de ' + signo + plata(r.monto_cuota) +
        ' en ' + r.tarjeta + '.'
      : 'Anoté ' + r.descripcion + ' por ' + signo + plata(r.monto_cuota) + ' en ' + r.tarjeta + '.'
  );

  if (r.cuota_estimada) {
    frases.push(
      'La cuota la saqué del total dividido ' + cuotas +
      '; si con los intereses es otra, decímela.'
    );
  }

  /*
    Lo contraintuitivo, dicho en voz alta. La persona acaba de gastar y va a
    buscar la compra en su panel del mes: si no la encuentra y nadie le
    explicó por qué, concluye que no se anotó.
  */
  frases.push('No es un gasto de este mes: sale cuando pagues el resumen.');

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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'REGISTRAR_TARJETA'")) {
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
