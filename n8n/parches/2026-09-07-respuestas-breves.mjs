/**
 * Que EOS conteste más corto, porque cada token son milisegundos de espera.
 *
 *     node n8n/parches/2026-09-07-respuestas-breves.mjs
 *
 * ============================================================
 * POR QUÉ ESTO ES LATENCIA Y NO ESTILO
 * ============================================================
 *
 * Medido el 7 de septiembre sobre ejecuciones reales (ver
 * `docs/latencia-del-chat.md`): la llamada al modelo son **~3,5 s fijos más
 * ~12 ms por token de salida**. Dos puntos de la recta, los dos de
 * producción: 117 tokens → 4,2 s; 711 tokens → 11,2 s.
 *
 * O sea que la mitad del tiempo del modelo no es "pensar": es escribir.
 *
 * Y hay de dónde sacar. Esta es una respuesta real, de 711 tokens:
 *
 *   "Perfecto. Con los costos que calculamos y los precios de venta que
 *    definiste, los márgenes quedan así: Conjunto azul: venta 168.000, costo
 *    122.414,5 → ganancia 45.585,5 → margen sobre venta 27,13%. […]
 *    Voy a guardar también estos márgenes junto con la información de esos
 *    productos."
 *
 *   acciones: [{ tipo: GUARDAR_MEMORIA, datos: { texto: "Márgenes de
 *   productos: Conjunto azul: precio venta 168.000, costo total 122.414,5,
 *   ganancia 45.585,5, margen sobre venta 27,13%. […]" }}]
 *
 * Los mismos cuatro márgenes, escritos dos veces enteras. Más un "Perfecto"
 * de apertura y un anuncio final de lo que iba a hacer. Sacando la
 * duplicación y el preámbulo, el mismo contenido entra en la mitad, y la
 * persona espera unos 4 segundos menos por exactamente la misma información.
 *
 * ============================================================
 * BREVE NO ES SECO
 * ============================================================
 *
 * El otro reporte del mismo día fue que a EOS "le falta mucha más
 * inteligencia". No son pedidos opuestos: lo que se lee como poco inteligente
 * es el relleno —repetir el pedido, anunciar lo que va a hacer, adornar—, no
 * la densidad. Por eso la última regla dice explícitamente qué NO se saca: la
 * advertencia que hace falta y la aclaración sin la cual un número se lee mal.
 */

import fs from "node:fs";
import path from "node:path";

import { aplicar } from "./cambios-respuestas-breves.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "JRgzUkoHBKgGpyPA";

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

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`), JSON.stringify(flujo, null, 2));

const http = flujo.nodes.find((n) => n.name === "HTTP Request");
if (!http) throw new Error("no existe el nodo HTTP Request");
if (http.parameters.jsonBody.includes("Sin preámbulo")) {
  throw new Error("El prompt ya tiene las reglas de brevedad. No se escribió nada.");
}

http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

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
console.log("gateway actualizado: reglas de brevedad. Reexportar con: node n8n/exportar.mjs gateway");
