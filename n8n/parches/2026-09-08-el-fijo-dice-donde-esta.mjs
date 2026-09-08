/**
 * El gasto fijo del negocio decía que se cambia donde no está.
 *
 *     node n8n/parches/2026-09-08-el-fijo-dice-donde-esta.mjs
 *
 * ============================================================
 * EL CASO
 * ============================================================
 *
 * Desde la v136 REGISTRAR_GASTO_FIJO lleva ámbito, y la confirmación dice de
 * quién es: "Salario del capataz (del negocio): ₲ 1.500.000 por mes". Bien.
 *
 * Y después terminaba, para los dos casos, con:
 *
 *     "Lo cuento el día 7 de cada mes; si es otro, cambialo en Gastos."
 *
 * Dos cosas mal en una frase. "Gastos" es el nombre viejo de la sección
 * Personal, que desde hoy se llama Personal. Y el fijo del NEGOCIO no está
 * ahí: la ruta de fijos estaba acotada a los personales, así que un costo fijo
 * del negocio se guardaba, entraba en el resultado y en la rentabilidad, y no
 * aparecía en ninguna pantalla.
 *
 * O sea que la frase mandaba a alguien a buscar en el lugar equivocado algo
 * que además no se veía en ningún lugar. Es la misma familia de error que
 * vengo sacando todo el día: la confirmación afirmando algo que no es.
 *
 * Arreglado del otro lado —la ruta acepta ámbito y los fijos del negocio se
 * ven y se editan en Negocio > Resultado— y acá la frase dice cuál de los dos.
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

const VIEJO = `    'Lo cuento ' + (mismoDia ? 'el día ' + dias[0] : 'en el día que registré cada uno') +
    ' de cada mes; si es otro, cambialo en Gastos.'`;

const NUEVO = `    'Lo cuento ' + (mismoDia ? 'el día ' + dias[0] : 'en el día que registré cada uno') +
    ' de cada mes; si es otro, cambialo en ' + donde + '.'`;

const DONDE_VIEJO = `  const dias = fijos.map(function (f) { return f.dia_del_mes; });`;

const DONDE_NUEVO = `  /*
    Dónde se corrige, que no es el mismo lugar para los dos.

    Los del negocio viven en Negocio > Resultado y los de la persona en
    Personal. Mandar a alguien a la sección equivocada a buscar algo que ahí no
    está es tan malo como no decir nada: se busca, no se encuentra, y lo que
    queda es que el sistema no lo guardó.
  */
  const soloNegocio = fijos.every(function (f) { return f.ambito === 'negocio'; });
  const soloPersonal = fijos.every(function (f) { return f.ambito !== 'negocio'; });
  const donde = soloNegocio
    ? 'Negocio > Resultado'
    : soloPersonal
      ? 'Personal'
      : 'la sección de cada uno';

  const dias = fijos.map(function (f) { return f.dia_del_mes; });`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(
  path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`),
  JSON.stringify(flujo, null, 2),
);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string" || !codigo.includes(VIEJO)) continue;
  if (codigo.includes("soloNegocio")) {
    throw new Error(`El nodo "${nodo.name}" ya está parcheado. No se escribió nada.`);
  }

  nodo.parameters.jsCode = codigo.replace(DONDE_VIEJO, DONDE_NUEVO).replace(VIEJO, NUEVO);
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
