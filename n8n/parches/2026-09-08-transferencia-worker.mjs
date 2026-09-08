/**
 * La cuarta punta de REGISTRAR_TRANSFERENCIA, y su frase.
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

const BLANCA_VIEJA = `  'REGISTRAR_MOVIMIENTO_PERSONAL'
]);`;

const BLANCA_NUEVA = `  'REGISTRAR_MOVIMIENTO_PERSONAL',

  /*
    Plata movida entre cuentas propias. No es gasto ni ingreso: por eso tiene
    acción propia y tabla propia.
  */
  'REGISTRAR_TRANSFERENCIA'
]);`;

const DESPACHO_VIEJO = `  if (accion === 'REGISTRAR_MOVIMIENTO_PERSONAL') return fraseDePersonal(result);
  return null;
}`;

const DESPACHO_NUEVO = `  if (accion === 'REGISTRAR_MOVIMIENTO_PERSONAL') return fraseDePersonal(result);
  if (accion === 'REGISTRAR_TRANSFERENCIA') return fraseDeTransferencia(result);
  return null;
}

/*
  Dice explícitamente que NO es un gasto.

  Es la única confirmación del sistema que tiene que negar algo, y hace falta:
  la persona acaba de ver a EOS anotar sus gastos toda la semana, y sin esa
  frase queda con la duda de si esta transferencia le va a aparecer como uno.
  Esa duda es la que hace que la gente deje de anotarlas.
*/
function fraseDeTransferencia(result) {
  const r = (result && result.resultado) || {};
  if (!r.monto) return 'No quedó registrada la transferencia.';

  const cierre = (r.origen_conocida && r.destino_conocida)
    ? ''
    : ' Todavía no tengo esas cuentas cargadas: si las agregás en Personal, puedo seguirte el saldo de cada una.';

  return 'Moviste ₲ ' + plata(r.monto) + ' de ' + r.origen + ' a ' + r.destino +
    '. No lo cuento como gasto ni como ingreso: la plata es la misma, cambió de lugar.' + cierre;
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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'REGISTRAR_TRANSFERENCIA'")) {
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
