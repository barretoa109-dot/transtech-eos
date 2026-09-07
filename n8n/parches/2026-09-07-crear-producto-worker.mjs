/**
 * La CUARTA punta: la lista blanca del worker.
 *
 *     node n8n/parches/2026-09-07-crear-producto-worker.mjs
 *
 * ============================================================
 * EL MISMO ERROR QUE YA ESTÁ DOCUMENTADO EN ESE NODO
 * ============================================================
 *
 * Con CREAR_PRODUCTO dado de alta en la base, el ejecutor, la tabla de riesgo,
 * el prompt y los dos nodos del gateway, la acción seguía sin ejecutarse. El
 * nodo 07 del gateway llamaba al worker, tardaba siete segundos y devolvía
 * `{}`.
 *
 * El motivo estaba en `01 INT Preparar`, que tiene SU PROPIA lista blanca:
 *
 *     if (!allowed.has(accion)) {
 *       throw new Error(`Acción no permitida en este endpoint: ${accion}`);
 *     }
 *
 * Y arriba de esa lista, palabra por palabra, este comentario:
 *
 *     "Las tres del negocio. Estaban listas en todos lados menos acá. El
 *      modelo las sabía pedir, el prompt se las enseñaba, el gateway tenía su
 *      ruta, la tabla de riesgo del gate les daba tier 3, los constraints de
 *      la base las admitían desde la v83 y el ejecutor existía desde la v84.
 *      Pero esta lista no las incluía, así que el worker las rechazaba antes
 *      de llegar a pedir autorización."
 *
 * El mismo error, con la misma acción nueva, seis días después. La nota decía
 * "tres lugares del workflow" y son CUATRO: el prompt, la lista blanca del
 * nodo 05 del gateway, el mapa de rutas del 06, **y esta lista del worker**.
 *
 * Que el fallo no diga nada es lo que lo hace repetible: el gateway recibe un
 * `{}`, no hay error visible, y desde el chat parece que la acción se ejecutó.
 *
 * ============================================================
 * Y LA FRASE DE CONFIRMACIÓN
 * ============================================================
 *
 * `05 INT Respuesta` tiene un mapa de frases por acción. Sin la suya, el
 * usuario que carga su catálogo lee "La acción quedó completada", que después
 * de dictar cuatro productos no le dice si entraron los cuatro.
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

const BLANCA_VIEJA = `  'REGISTRAR_VENTA',
  'AJUSTAR_STOCK',
  'CREAR_CONTACTO'
]);`;

const BLANCA_NUEVA = `  'REGISTRAR_VENTA',
  'AJUSTAR_STOCK',
  'CREAR_CONTACTO',

  /*
    Cargar productos al catálogo (v131). Cuarta acción del negocio, y cuarto
    lugar donde hay que darla de alta: cuando faltó SOLO acá, el gateway
    recibía un {} sin error y desde el chat parecía que se había ejecutado.
  */
  'CREAR_PRODUCTO'
]);`;

const FRASE_VIEJA = `  CREAR_CONTACTO: 'El contacto quedó guardado. Lo ves en Negocio > Contactos.'`;

const FRASE_NUEVA = `  CREAR_CONTACTO: 'El contacto quedó guardado. Lo ves en Negocio > Contactos.',
  CREAR_PRODUCTO: 'Los productos quedaron cargados. Los ves en Negocio > Productos.'`;

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

  if (nuevo.includes(BLANCA_VIEJA) && !nuevo.includes("'CREAR_PRODUCTO'")) {
    nuevo = nuevo.replace(BLANCA_VIEJA, BLANCA_NUEVA);
  }

  if (nuevo.includes(FRASE_VIEJA) && !nuevo.includes("CREAR_PRODUCTO:")) {
    nuevo = nuevo.replace(FRASE_VIEJA, FRASE_NUEVA);
  }

  if (nuevo !== codigo) {
    nodo.parameters.jsCode = nuevo;
    tocados += 1;
    console.log(`  ${nodo.name}: parcheado`);
  }
}

if (tocados === 0) {
  throw new Error("No encontré ni la lista blanca ni el mapa de frases. No se escribió nada.");
}

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
