/**
 * Que la confirmación de productos diga lo que de verdad pasó.
 *
 *     node n8n/parches/2026-09-07-producto-dice-la-verdad.mjs
 *
 * ============================================================
 * EL CASO
 * ============================================================
 *
 * Se pidió "agregá el Conjunto amarillo a 200.000gs" sobre un producto que ya
 * estaba a 165.000. La regla de la v131 hizo lo correcto —no le cambió el
 * precio, porque crear no es editar— y EOS igual contestó:
 *
 *     "Los productos quedaron cargados. Los ves en Negocio > Productos."
 *
 * Nada quedó cargado, y peor: quien lea eso se va convencido de que su
 * producto ahora vale 200.000. La frase venía de `doneText`, un mapa fijo por
 * acción que no mira el resultado.
 *
 * Es la misma familia de error que el 6 de septiembre: afirmar un final que no
 * ocurrió. Cambia el mecanismo, no la consecuencia.
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * Para CREAR_PRODUCTO la frase se arma con `creados` y `ya_existian`, que el
 * ejecutor devuelve en el resultado desde la v132:
 *
 *   · cargó algunos           → "Cargué 3 productos…"
 *   · ninguno, todos existían → "«Conjunto amarillo» ya estaba en tu catálogo
 *                                y no le toqué el precio…"
 *   · mezcla                  → las dos cosas, en ese orden
 *
 * El resto de las acciones sigue con su frase fija: son de a una y no tienen
 * nada que contar además de que se hicieron.
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

async function traer() {
  const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
  if (!r.ok) throw new Error(`GET falló: ${r.status} ${await r.text()}`);
  return r.json();
}

const AYUDANTE = `
/*
  La frase de CREAR_PRODUCTO se arma con lo que pasó, no con un texto fijo.

  El ejecutor devuelve \`creados\` y \`ya_existian\` (v132). Sin mirarlos, la
  respuesta decía "los productos quedaron cargados" incluso cuando no se cargó
  ninguno porque todos ya estaban — y quien lo lee se va creyendo que le
  cambiamos el precio.
*/
function fraseDeProductos(result) {
  const r = (result && result.resultado) || {};
  const creados = Array.isArray(r.creados) ? r.creados : [];
  const existian = Array.isArray(r.ya_existian) ? r.ya_existian : [];

  const partes = [];

  if (creados.length === 1) {
    partes.push(\`Cargué \\u201C\${creados[0].nombre}\\u201D en tu catálogo.\`);
  } else if (creados.length > 1) {
    partes.push(\`Cargué \${creados.length} productos en tu catálogo.\`);
  }

  if (existian.length === 1) {
    partes.push(
      \`\\u201C\${existian[0]}\\u201D ya estaba y no le toqué el precio: cambiarlo todavía se hace desde Negocio > Productos.\`
    );
  } else if (existian.length > 1) {
    partes.push(
      \`\${existian.length} ya estaban y no les toqué el precio: cambiarlo todavía se hace desde Negocio > Productos.\`
    );
  }

  if (!partes.length) return 'No quedó ningún producto para cargar.';

  if (creados.length) partes.push('Los ves en Negocio > Productos.');

  return partes.join(' ');
}
`;

const VIEJO = `    respuesta: success
      ? (doneText[prep.accion] || 'La acción quedó completada.')
      : motivoDelError(result)`;

const NUEVO = `    respuesta: success
      ? (prep.accion === 'CREAR_PRODUCTO'
          ? fraseDeProductos(result)
          : (doneText[prep.accion] || 'La acción quedó completada.'))
      : motivoDelError(result)`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

let tocados = 0;

for (const nodo of flujo.nodes) {
  const codigo = nodo.parameters?.jsCode;
  if (typeof codigo !== "string" || !codigo.includes(VIEJO)) continue;
  if (codigo.includes("fraseDeProductos")) {
    throw new Error(`El nodo "${nodo.name}" ya está parcheado. No se escribió nada.`);
  }

  nodo.parameters.jsCode = AYUDANTE + codigo.replace(VIEJO, NUEVO);
  tocados += 1;
  console.log(`  ${nodo.name}: parcheado`);
}

if (tocados === 0) throw new Error("No encontré el armado de `respuesta`. No se escribió nada.");

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
console.log(`workflow actualizado (${tocados} nodo/s).`);

const nuevo = await traer();
for (const n of nuevo.nodes) delete n.credentials;
fs.writeFileSync(
  path.join(RAIZ, "n8n", "workflows", "eos-background-worker-rc1.json"),
  JSON.stringify(
    { name: nuevo.name, nodes: nuevo.nodes, connections: nuevo.connections, settings: nuevo.settings },
    null,
    2,
  ),
);
console.log("reexportado a n8n/workflows/eos-background-worker-rc1.json");
