/**
 * La Puerta de Admisión bloqueaba pedidos legítimos porque el nodo que busca
 * la reserva traía la reserva EQUIVOCADA.
 *
 *     SECO=1 node n8n/parches/2026-09-22-admision-reserva-correcta.mjs   (prueba)
 *     node n8n/parches/2026-09-22-admision-reserva-correcta.mjs          (escribe)
 *
 * ============================================================
 * EL CASO QUE LO DESCUBRIÓ
 * ============================================================
 *
 * El 2026-09-22, una usuaria mandó una imagen por WhatsApp. La etapa 1
 * (`conversar()`, `lib/gateway/conversar.ts`) intentó atenderla directo desde
 * Vercel, se colgó los 60 s completos contra OpenAI (la imagen de WhatsApp
 * viaja sin achicar) y recién ahí delegó a n8n. En esos 60 s la usuaria mandó
 * OTRO mensaje, que se procesó bien y consumió SU reserva.
 *
 * Cuando la ejecución demorada por fin llegó a n8n (ejecución `10878`,
 * verificada por la API de ejecuciones), el nodo `01.5 GW Verificar Reserva
 * API` — un nodo Supabase `getAll` con `limit: 1` y tres condiciones
 * (`usuario_id`, `request_id`, `status`) — devolvió la reserva del OTRO
 * mensaje: la más reciente del usuario, ya `consumed`, no la propia. Los
 * datos lo prueban: la fila que trajo tenía un `request_id` distinto al que
 * pedía el filtro. El nodo (`typeVersion: 1`, la versión vieja del nodo
 * Supabase de n8n) solo aplica la PRIMERA condición del filtro; el resto se
 * ignoran en silencio. Con `limit: 1` eso significa "la reserva más reciente
 * del usuario", no "la reserva de este pedido".
 *
 * Como esa fila no estaba en `reserved`, `01.6 GW Admission Gate` bloqueó un
 * pedido que SÍ tenía una reserva válida y vigente. n8n devolvió un cuerpo
 * vacío, y eso dispara el mensaje genérico de
 * `lib/eos/procesar-mensaje.ts:1018` ("EOS no pudo generar una respuesta
 * clara").
 *
 * ============================================================
 * POR QUÉ ESTE ARREGLO Y NO OTRO
 * ============================================================
 *
 * `01.6 GW Admission Gate` YA filtra en JavaScript por `usuario_id`,
 * `request_id`, `status`, vencimiento y `source` — con más de una fila
 * adelante, encuentra la correcta sola. El problema no es esa lógica: es que
 * el nodo de arriba solo le entrega UNA fila, y no necesariamente la
 * correcta. Subir el `limit` a 25 (un usuario no tiene 25 reservas en vuelo
 * al mismo tiempo salvo un caso patológico) le da al filtro de 01.6 con qué
 * trabajar, sin tener que adivinar por qué el constructor de filtros del nodo
 * Supabase v1 ignora la segunda y tercera condición.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const GATEWAY = "JRgzUkoHBKgGpyPA";

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

async function traer(id, intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: CABECERAS });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
  return null;
}

function nodo(flujo, prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

function respaldar(flujo, etiqueta) {
  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const destino = path.join(RAIZ, "n8n", "respaldos", `${sello}-${etiqueta}.json`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, destino)} (updatedAt ${flujo.updatedAt})`);
}

async function escribir(id, flujo, etiqueta) {
  console.log(`verificado ${etiqueta}: ${verificarFlujo(flujo, etiqueta)} nodos compilan`);

  if (process.env.SECO === "1") return;

  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers: CABECERAS,
    body: JSON.stringify({
      name: flujo.name,
      nodes: flujo.nodes,
      connections: flujo.connections,
      settings: flujo.settings ?? {},
    }),
  });

  if (!r.ok) throw new Error(`PUT ${etiqueta} falló: ${r.status} ${await r.text()}`);
  console.log(`${etiqueta} actualizado.`);
}

// ------------------------------------------------------------------ gateway
const gateway = await traer(GATEWAY);
respaldar(gateway, "gateway");

const n015 = nodo(gateway, "01.5 GW Verificar Reserva API");

if (n015.parameters.limit !== 1) {
  throw new Error(
    `El nodo ya tiene limit=${n015.parameters.limit}, no 1. Puede que ya esté arreglado. No se escribió nada.`,
  );
}

const LIMITE_NUEVO = 25;
n015.parameters.limit = LIMITE_NUEVO;

n015.notes =
  (n015.notes || "") +
  ` El nodo Supabase v1 solo aplica la primera condición del filtro (usuario_id); ` +
  `request_id y status se ignoran en el pedido a la API. Con limit=1 eso traía "la ` +
  `reserva más recia del usuario", no la de este pedido — bloqueó un pedido válido ` +
  `el 2026-09-22 porque el usuario ya tenía una reserva MÁS NUEVA consumida por otro ` +
  `mensaje. Subir el límite le da a 01.6 (que sí filtra bien, en JS) varias filas ` +
  `entre las que elegir la correcta.`;

await escribir(GATEWAY, gateway, "gateway");

if (process.env.SECO === "1") {
  console.log(`SECO=1: el nodo compila con limit=${LIMITE_NUEVO}. No se escribió nada.`);
} else {
  console.log("Seguir con: node n8n/exportar.mjs");
}
