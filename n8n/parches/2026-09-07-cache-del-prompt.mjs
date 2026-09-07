/**
 * Que OpenAI reuse el prompt del sistema en vez de releerlo cada vez.
 *
 *     node n8n/parches/2026-09-07-cache-del-prompt.mjs
 *
 * ============================================================
 * NO ALCANZÓ. QUEDA ESCRITO PARA QUE NO SE REINTENTE.
 * ============================================================
 *
 * El diagnóstico era razonable. En las nueve ejecuciones reales del 7 de
 * septiembre el `usage` decía siempre lo mismo:
 *
 *     "input_tokens": 4034,
 *     "input_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 0 }
 *
 * Cero, en todas, con un mensaje de sistema de ~1.500 tokens sin una sola
 * interpolación —idéntico byte a byte para todos los usuarios— y el caché
 * automático de OpenAI arrancando a los 1.024. Cuatro mensajes de la misma
 * persona con dos minutos entre uno y otro tendrían que haber pegado.
 *
 * La hipótesis era que faltaba `prompt_cache_key`: sin esa clave cada pedido
 * se rutea a una máquina distinta y no encuentra lo que dejó el anterior.
 *
 * Se aplicó y se volvió a medir con tres mensajes seguidos, mismo prefijo de
 * 1.765 tokens: `cached_tokens` 0, 0 y 0. La API acepta el campo —no devuelve
 * 400— así que está soportado, y el caché igual no pega. La causa es otra y
 * todavía no se sabe cuál.
 *
 * El campo se deja puesto porque es lo que recomienda OpenAI y no cuesta
 * nada. Pero NO cuenta como latencia ganada, y el que busque de dónde sacar
 * segundos no tiene que volver a pasar por acá: al 7 de septiembre la llamada
 * al modelo son ~3,5 s fijos más ~12 ms por token de salida, y los otros ~9 s
 * de los 19 que tarda el chat están medidos en `docs/latencia-del-chat.md`.
 *
 * ============================================================
 * POR QUÉ UNA CLAVE CONSTANTE Y NO EL USUARIO
 * ============================================================
 *
 * Lo que se cachea es el PREFIJO, y el prefijo acá es el prompt del sistema,
 * que es el mismo para todos. Con la clave por usuario, cada uno tendría su
 * propio caché y el primer mensaje de cada persona lo pagaría entero.
 *
 * No hay riesgo de que se mezcle nada entre cuentas: el caché es de prefijo y
 * el mensaje del usuario va después, así que lo único compartido es el texto
 * que ya es idéntico para todos.
 */

import fs from "node:fs";
import path from "node:path";

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

const VIEJO = `    reasoning: { effort: "low" },`;

const NUEVO = `    reasoning: { effort: "low" },

    /*
      Puesto para reusar el prefijo entre pedidos, y NO ALCANZÓ. Queda escrito
      acá para que nadie vuelva a intentarlo creyendo que es lo que falta.

      El diagnóstico era razonable: el mensaje de sistema son ~1.500 tokens
      sin una sola interpolación, idéntico byte a byte para todos, y el caché
      automático de OpenAI arranca a los 1.024. Aun así, "cached_tokens" venía
      0 en las nueve ejecuciones del 7 de septiembre. La hipótesis era que sin
      \`prompt_cache_key\` cada pedido cae en una máquina distinta.

      Se aplicó y se volvió a medir con tres mensajes seguidos, mismo prefijo
      de 1.765 tokens: "cached_tokens" 0, 0 y 0. La API acepta el campo —no
      devuelve 400— así que está soportado y el caché igual no pega. La causa
      es otra y todavía no se sabe cuál.

      Se deja puesto porque es lo que recomienda OpenAI y no cuesta nada, pero
      NO cuenta como latencia ganada: al 7 de septiembre la llamada al modelo
      son ~3,5 s fijos más ~12 ms por token de salida, medido.
    */
    prompt_cache_key: "eos-chat-gw-1",`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
fs.writeFileSync(path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`), JSON.stringify(flujo, null, 2));

const http = flujo.nodes.find((n) => n.name === "HTTP Request");
if (!http) throw new Error("no existe el nodo HTTP Request");
if (http.parameters.jsonBody.includes("prompt_cache_key")) {
  throw new Error("Ya tiene prompt_cache_key. No se escribió nada.");
}

const partes = http.parameters.jsonBody.split(VIEJO);
if (partes.length !== 2) throw new Error(`el ancla aparece ${partes.length - 1} veces, no 1`);
http.parameters.jsonBody = partes.join(NUEVO);

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
console.log("gateway actualizado: prompt_cache_key. Reexportar con: node n8n/exportar.mjs gateway");
