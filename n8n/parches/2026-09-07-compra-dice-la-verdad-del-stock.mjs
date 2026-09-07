/**
 * Que la compra no diga que sumó stock cuando no lo sumó.
 *
 *     node n8n/parches/2026-09-07-compra-dice-la-verdad-del-stock.mjs
 *
 * ============================================================
 * EL CASO
 * ============================================================
 *
 * A los diez minutos de salir REGISTRAR_COMPRA, probándola: "compré 20 chipas
 * a 2.600" sobre un producto que sí está en el catálogo. La confirmación dijo:
 *
 *   "A «chipas» le sumé el stock y le actualicé el costo."
 *
 * El costo sí. El stock no: ese producto tiene `controla_stock = false`, y la
 * función de compras —correctamente— solo mueve el saldo de los que llevan
 * inventario.
 *
 * La frase se armaba con `en_catalogo`, que responde a otra pregunta. Existir
 * en el catálogo y llevar inventario son dos cosas distintas.
 *
 * Es la afirmación falsa de peor clase: la que hace que alguien deje de
 * contar sus existencias porque cree que el sistema las cuenta.
 *
 * La v135 agrega `mueve_stock` al detalle de cada ítem. Acá se usa, y se
 * agrega la tercera frase que faltaba: está en el catálogo, se le actualizó el
 * costo, y no lleva stock.
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

const VIEJO = `  const dentro = items.filter(function (x) { return x.en_catalogo; });
  if (dentro.length) {
    frases.push(
      dentro.length === 1
        ? 'A \\u201C' + dentro[0].concepto + '\\u201D le sumé el stock y le actualicé el costo.'
        : 'A ' + dentro.length + ' de ellos les sumé stock y les actualicé el costo.'
    );
  }`;

const NUEVO = `  /*
    Tres estados distintos, y la diferencia importa:

      · en el catálogo y con inventario  -> subió el stock y el costo
      · en el catálogo sin inventario    -> SOLO el costo
      · fuera del catálogo               -> ni una cosa ni la otra

    El del medio decía lo mismo que el primero, y hacía creer que el sistema
    estaba contando existencias que nadie contaba.
  */
  const conStock = items.filter(function (x) { return x.mueve_stock; });
  const soloCosto = items.filter(function (x) { return x.en_catalogo && !x.mueve_stock; });

  if (conStock.length) {
    frases.push(
      conStock.length === 1
        ? 'A \\u201C' + conStock[0].concepto + '\\u201D le sumé el stock y le actualicé el costo.'
        : 'A ' + conStock.length + ' de ellos les sumé stock y les actualicé el costo.'
    );
  }

  if (soloCosto.length) {
    frases.push(
      (soloCosto.length === 1
        ? 'A \\u201C' + soloCosto[0].concepto + '\\u201D le actualicé el costo'
        : 'A ' + soloCosto.length + ' de ellos les actualicé el costo') +
      ', pero no llevan inventario, así que el stock no se movió. Se activa en Negocio > Productos.'
    );
  }`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string" || !codigo.includes(VIEJO)) continue;
  if (codigo.includes("mueve_stock")) {
    throw new Error(`El nodo "${nodo.name}" ya está parcheado. No se escribió nada.`);
  }

  nodo.parameters.jsCode = codigo.replace(VIEJO, NUEVO);
  tocados += 1;
  console.log(`  ${nodo.name}: parcheado`);
}

if (tocados !== 1) throw new Error(`Esperaba 1 nodo y toqué ${tocados}. No se escribió nada.`);

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
console.log("worker actualizado. Reexportar con: node n8n/exportar.mjs worker");
