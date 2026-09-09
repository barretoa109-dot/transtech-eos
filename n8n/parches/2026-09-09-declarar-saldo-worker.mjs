/**
 * La cuarta punta de DECLARAR_SALDO, y su frase.
 *
 *     node n8n/parches/2026-09-09-declarar-saldo-worker.mjs
 *
 * La frase tiene que decir EN QUÉ CUENTA y CUÁNTO HABÍA ANTES. Es lo único
 * que le permite a la persona darse cuenta de que EOS escribió el saldo en la
 * cuenta equivocada: los dos números quedan plausibles y nadie lo descubre
 * mirando el panel.
 *
 * Y tiene que decir la moneda, siempre. "3.000.000" sobre una cuenta en
 * dólares es mil veces el patrimonio real, y el único momento en que se puede
 * ver es cuando la persona todavía se acuerda de lo que dijo.
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

const BLANCA_VIEJA = `  'CORREGIR_MOVIMIENTO'
]);`;

const BLANCA_NUEVA = `  'CORREGIR_MOVIMIENTO',

  /*
    Anotar cuánta plata hay en una cuenta. Cuesta 1 punto, el mínimo: es el
    dato del que dependen el patrimonio, el disponible real y la cobertura del
    fondo de emergencia, y el que más cambia. Cobrarle presupuesto de riesgo a
    la persona por contarle a EOS cuánto tiene la enseñaría a no contárselo.
  */
  'DECLARAR_SALDO'
]);`;

const DESPACHO_VIEJO = `  if (accion === 'CORREGIR_MOVIMIENTO') return fraseDeCorreccion(result);
  return null;
}`;

const DESPACHO_NUEVO = `  if (accion === 'CORREGIR_MOVIMIENTO') return fraseDeCorreccion(result);
  if (accion === 'DECLARAR_SALDO') return fraseDeSaldo(result);
  return null;
}

/*
  La frase dice EN QUÉ CUENTA, CUÁNTO y CUÁNTO HABÍA.

  El antes es lo que permite ver que EOS escribió en la cuenta equivocada:
  'Ueno pasó de 1.200.000 a 3.000.000' sobre una cuenta que la persona sabe
  que tenía otra cosa se nota en el acto. Sin él, un saldo en el lugar
  equivocado deja mal el patrimonio, el disponible y la cobertura a la vez, y
  los dos números quedan plausibles.

  La moneda va siempre: '3.000.000' sobre una cuenta en dólares es mil veces
  el patrimonio real.

  Y si la cuenta quedó sin clasificar, se dice. Es lo que se evitó suponer, y
  ofrecerlo en una línea cuesta menos que una pantalla.
*/
function signoDe(moneda) {
  if (moneda === 'USD') return 'US$ ';
  if (!moneda || moneda === 'PYG') return '₲ ';
  return moneda + ' ';
}

function fraseDeSaldo(result) {
  const r = (result && result.resultado) || {};
  if (!r.cuenta) return null;

  const signo = signoDe(r.moneda);
  const cuanto = signo + plata(r.saldo);
  const frases = [];

  if (r.creada) {
    frases.push('Anoté ' + cuanto + ' en ' + r.cuenta + '. Cuenta nueva.');
    if (r.sin_clasificar) {
      frases.push('Quedó sin clasificar: decime si es banco, cooperativa, financiera o billetera.');
    }
  } else if (r.antes === null || r.antes === undefined) {
    frases.push('Anoté ' + cuanto + ' en ' + r.cuenta + '.');
  } else if (Number(r.antes) === Number(r.saldo)) {
    frases.push(r.cuenta + ' sigue en ' + cuanto + '.');
  } else {
    frases.push(r.cuenta + ' pasó de ' + signo + plata(r.antes) + ' a ' + cuanto + '.');
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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'DECLARAR_SALDO'")) {
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
