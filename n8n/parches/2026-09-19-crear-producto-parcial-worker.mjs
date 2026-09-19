/**
 * Que la respuesta de CREAR_PRODUCTO diga qué producto quedó sin cargar.
 *
 *     SECO=1 node n8n/parches/2026-09-19-crear-producto-parcial-worker.mjs   (prueba)
 *     node n8n/parches/2026-09-19-crear-producto-parcial-worker.mjs          (escribe)
 *
 * Va con la v181 (`eos_erp_crear_productos_v131` ya no aborta la lista entera
 * cuando a un producto nuevo le falta el precio: lo saltea y lo devuelve en
 * `sin_precio`). Sin este cambio la respuesta diría "Cargué 1 producto" y la
 * persona no sabría que otro quedó afuera, ni por qué.
 *
 * Toca UN solo lugar: `fraseDeProductos` en el nodo "05 INT Respuesta" del
 * worker. Es tolerante: si el resultado no trae `sin_precio` (la v181 todavía no
 * está aplicada, o un reintento idempotente), no agrega nada y todo sigue igual.
 *
 * Después de aplicar:  node n8n/exportar.mjs worker
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

const VIEJO = [
  "  if (creados.length) partes.push('Los ves en Negocio > Productos.');",
  "",
  "  return partes.join(' ');",
].join("\n");

const NUEVO = [
  "  if (creados.length) partes.push('Los ves en Negocio > Productos.');",
  "",
  "  /*",
  "    Lo que quedó SIN cargar por falta de precio de venta (v181).",
  "",
  "    Un producto sin precio haría que la primera venta se registre en cero, así",
  "    que no se carga; pero el resto de la lista sí, y la persona tiene que saber",
  "    cuál falta para poder completarlo.",
  "  */",
  "  const sinPrecio = Array.isArray(r.sin_precio) ? r.sin_precio : [];",
  "",
  "  if (sinPrecio.length === 1) {",
  "    partes.push(`No cargué \u201C${sinPrecio[0]}\u201D porque me falta a cuánto lo vendés: decime el precio y lo cargo.`);",
  "  } else if (sinPrecio.length > 1) {",
  "    const nombres = sinPrecio.map((n) => `\u201C${n}\u201D`).join(', ');",
  "    partes.push(`No cargué ${nombres} porque me falta a cuánto los vendés: decime el precio de cada uno y los cargo.`);",
  "  }",
  "",
  "  return partes.join(' ');",
].join("\n");

const { N8N_BASE_URL, N8N_API_KEY } = env();
const BASE = N8N_BASE_URL.replace(/\/$/, "");
const CABECERAS = { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" };

const r0 = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
if (!r0.ok) throw new Error(`GET falló: ${r0.status} ${await r0.text()}`);
const flujo = await r0.json();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.mkdirSync(path.dirname(respaldo), { recursive: true });
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

const nodo = flujo.nodes.find((n) => n.name === "05 INT Respuesta");
if (!nodo) throw new Error('No existe el nodo "05 INT Respuesta".');

const codigo = nodo.parameters.jsCode;
if (codigo.includes("const sinPrecio = Array.isArray(r.sin_precio)")) {
  throw new Error("El worker ya tiene el aviso de productos sin precio. No se escribió nada.");
}

const partes = codigo.split(VIEJO);
if (partes.length !== 2) {
  throw new Error(`El cierre de fraseDeProductos aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
}
if (NUEVO.includes("``")) throw new Error("comilla invertida doble");

nodo.parameters.jsCode = partes.join(NUEVO);

console.log(`verificado: ${verificarFlujo(flujo, "worker")} nodos compilan`);

if (process.env.SECO === "1") {
  console.log("SECO=1: el anclaje encajó y el workflow compila. No se escribió nada.");
} else {
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
  console.log("worker actualizado: CREAR_PRODUCTO avisa qué productos quedaron sin precio.");
  console.log("Seguir con: node n8n/exportar.mjs worker");
}
