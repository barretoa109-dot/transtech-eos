/**
 * La cuarta punta de REGISTRAR_OPORTUNIDAD, y su frase.
 *
 *     node n8n/parches/2026-09-10-oportunidad-worker.mjs
 *
 * Dos cosas que la frase tiene que decir:
 *
 *   1. SI LA CREÓ O SI MOVIÓ UNA QUE YA ESTABA, y en ese caso DE DÓNDE
 *      VENÍA. Es lo único que le permite a la persona darse cuenta de que EOS
 *      movió el negocio equivocado: el título que confirma puede no ser el que
 *      ella nombró.
 *
 *   2. SI QUEDÓ SIN MONTO. Un embudo con huecos es honesto; uno con montos
 *      inventados se lee como una previsión de ingresos. Decirlo acá es lo que
 *      hace que el hueco se llene.
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

const BLANCA_VIEJA = `  'REGISTRAR_TARJETA',
  'REGISTRAR_COMPRA_TARJETA'
]);`;

const BLANCA_NUEVA = `  'REGISTRAR_TARJETA',
  'REGISTRAR_COMPRA_TARJETA',

  /*
    El embudo. Cuesta 2, como una tarea: no mueve plata ni stock, es una fila
    que la persona puede borrar de una pantalla.
  */
  'REGISTRAR_OPORTUNIDAD'
]);`;

const DESPACHO_VIEJO = `  if (accion === 'REGISTRAR_COMPRA_TARJETA') return fraseDeCompraTarjeta(result);
  return null;
}`;

const DESPACHO_NUEVO = `  if (accion === 'REGISTRAR_COMPRA_TARJETA') return fraseDeCompraTarjeta(result);
  if (accion === 'REGISTRAR_OPORTUNIDAD') return fraseDeOportunidad(result);
  return null;
}

var ETAPAS = {
  nueva: 'nueva',
  contactado: 'contactado',
  propuesta: 'propuesta enviada',
  negociacion: 'negociación',
  ganada: 'ganada',
  perdida: 'perdida'
};

function fraseDeOportunidad(result) {
  const r = (result && result.resultado) || {};
  if (!r.titulo) return null;

  const signo = signoDe(r.moneda);
  const etapa = ETAPAS[r.etapa] || r.etapa;
  const frases = [];

  if (r.creada) {
    frases.push(
      'Anoté ' + r.titulo + (r.contacto ? ' con ' + r.contacto : '') +
      (Number(r.monto) > 0 ? ' por ' + signo + plata(r.monto) : '') + '.'
    );
    if (r.etapa !== 'nueva') frases.push('En ' + etapa + '.');
  } else {
    /*
      El título que se confirma puede NO ser el que la persona nombró: se
      avanza el negocio que ya estaba y conserva su nombre. Decirlo entero es
      lo único que permite ver que EOS movió el equivocado.
    */
    frases.push(
      r.etapa_antes && r.etapa_antes !== r.etapa
        ? r.titulo + ': de ' + (ETAPAS[r.etapa_antes] || r.etapa_antes) + ' a ' + etapa + '.'
        : 'Actualicé ' + r.titulo + ' (' + etapa + ').'
    );
  }

  if (r.etapa === 'ganada') {
    frases.push('La marqué ganada; si además vendiste, contame qué para cargar la venta.');
  }

  if (r.sin_monto) {
    frases.push('Quedó sin monto: cuando lo sepas, decímelo y lo sumo al embudo.');
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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'REGISTRAR_OPORTUNIDAD'")) {
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
