/**
 * Cerrar los dos webhooks de n8n que atendían a cualquiera.
 *
 *     SECO=1 node n8n/parches/2026-09-28-webhooks-cerrados.mjs worker      (prueba)
 *     node n8n/parches/2026-09-28-webhooks-cerrados.mjs worker             (escribe)
 *
 *     SECO=1 node n8n/parches/2026-09-28-webhooks-cerrados.mjs decisiones  (prueba)
 *     node n8n/parches/2026-09-28-webhooks-cerrados.mjs decisiones         (escribe)
 *
 * ============================================================
 * POR QUÉ
 * ============================================================
 *
 * El repositorio es público, y con él las URLs de n8n. Revisados el
 * 2026-09-28 todos los workflows ACTIVOS de la instancia:
 *
 * - Los webhooks `eos-worker-rc1-*` le pasan el `Authorization` a la app, que
 *   lo valida con `EOS_WORKER_GATE_SECRET` (`lib/seguridad/worker-bearer.ts`).
 *   `eos-chat` exige una reserva de cupo creada por la app. Esos están bien.
 *
 * - `eos-worker` (EOS 3.0 - Background Worker - Ejecución Confiable v3,
 *   `YoF7ZFEI0ChyGNWn`) es el worker ANTERIOR al RC1. Nada lo llama: el gateway
 *   manda todo a `eos-worker-rc1-*` y ninguna ruta de la app apunta a él. Pero
 *   seguía ACTIVO y sin autenticación: con un `usuario_id` leía memorias,
 *   objetivos, tareas y conversaciones de esa persona, se las pasaba a OpenAI,
 *   devolvía la respuesta y podía escribir tareas, objetivos y memorias en su
 *   cuenta. Se DESACTIVA (no se borra: `worker` guarda un respaldo antes).
 *
 * - `eos-decision-capture` (EOS 3.0 - Registro de Decisiones y Resultados v6,
 *   `xwFkncvx2T7DYAm8`) sí está en uso: `lib/eos/procesar-mensaje.ts` le manda
 *   cada intercambio del chat. Pero no pedía nada: cualquiera podía hacerle
 *   gastar OpenAI en un bucle y escribir decisiones en la cuenta de otro. Desde
 *   este cambio la app manda `Authorization: Bearer <EOS_WORKER_GATE_SECRET>`
 *   (el mismo secreto que ya usa el worker RC1, que n8n tiene en `$env`), y
 *   el nodo 01 descarta en silencio lo que no lo traiga, ANTES de OpenAI.
 *
 * ORDEN: `decisiones` se corre DESPUÉS de que el deploy de la app con la
 * cabecera esté en producción. Si se corre antes, las decisiones del chat
 * dejan de capturarse hasta el deploy (no rompe nada más: la captura corre en
 * `after()`, fuera de la respuesta al usuario).
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

const WORKER_LEGADO = "YoF7ZFEI0ChyGNWn";
const DECISIONES = "xwFkncvx2T7DYAm8";

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
const SECO = process.env.SECO === "1";

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

function respaldar(flujo, etiqueta) {
  const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const destino = path.join(RAIZ, "n8n", "respaldos", `${sello}-${etiqueta}.json`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(flujo, null, 2));
  console.log(`respaldo: ${path.relative(RAIZ, destino)} (updatedAt ${flujo.updatedAt})`);
}

// ------------------------------------------------------------------ worker legado
async function desactivarWorkerLegado() {
  const flujo = await traer(WORKER_LEGADO);
  const hook = flujo.nodes.find((n) => /webhook$/i.test(n.type) && n.parameters?.path === "eos-worker");
  if (!hook) throw new Error("El workflow ya no tiene el webhook eos-worker. No se tocó nada.");

  if (!flujo.active) {
    console.log(`"${flujo.name}" ya está inactivo. Nada que hacer.`);
    return;
  }

  respaldar(flujo, "worker-v3-legado");
  if (SECO) {
    console.log(`SECO=1: se desactivaría "${flujo.name}". No se escribió nada.`);
    return;
  }

  const r = await fetch(`${BASE}/api/v1/workflows/${WORKER_LEGADO}/deactivate`, {
    method: "POST",
    headers: CABECERAS,
  });
  if (!r.ok) throw new Error(`deactivate falló: ${r.status} ${await r.text()}`);

  const despues = await traer(WORKER_LEGADO);
  console.log(`"${despues.name}" activo: ${despues.active}`);

  const prueba = await fetch(`${BASE}/webhook/eos-worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(`POST /webhook/eos-worker -> ${prueba.status} (se espera 404)`);
}

// ------------------------------------------------------------------ decisiones
const ANCLA = "const body = $json.body || $json;";
const GUARDIA = `// Solo la app (lib/eos/procesar-mensaje.ts) puede pedir una captura: el webhook
// es público. Sin el secreto, se descarta ANTES de gastar OpenAI.
const cabeceras = $json.headers || {};
const secreto = String($env.EOS_WORKER_GATE_SECRET || '');
const autorizacion = String(cabeceras.authorization || cabeceras.Authorization || '');
if (!secreto || autorizacion !== 'Bearer ' + secreto) return [];
`;

async function cerrarDecisiones() {
  const flujo = await traer(DECISIONES);
  const n01 = flujo.nodes.find((n) => n.name === "01 F6 Detectar candidato");
  if (!n01) throw new Error('No existe el nodo "01 F6 Detectar candidato". No se tocó nada.');

  const codigo = n01.parameters.jsCode;
  if (codigo.includes("EOS_WORKER_GATE_SECRET")) {
    console.log("El nodo 01 ya exige el secreto. Nada que hacer.");
    return;
  }
  if (!codigo.startsWith(ANCLA)) {
    throw new Error("El nodo 01 cambió desde que se escribió este parche. No se tocó nada.");
  }

  respaldar(flujo, "decisiones");
  n01.parameters.jsCode = GUARDIA + codigo;
  console.log(`verificado decisiones: ${verificarFlujo(flujo, "decisiones")} nodos compilan`);

  if (SECO) {
    console.log("SECO=1: el nodo compila con la guardia. No se escribió nada.");
    return;
  }

  const r = await fetch(`${BASE}/api/v1/workflows/${DECISIONES}`, {
    method: "PUT",
    headers: CABECERAS,
    body: JSON.stringify({
      name: flujo.name,
      nodes: flujo.nodes,
      connections: flujo.connections,
      settings: flujo.settings ?? {},
    }),
  });
  if (!r.ok) throw new Error(`PUT decisiones falló: ${r.status} ${await r.text()}`);
  console.log("decisiones actualizado.");

  // Sin cabecera: el webhook contesta, pero el nodo 01 corta antes de OpenAI.
  const prueba = await fetch(`${BASE}/webhook/eos-decision-capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario_id: "00000000-0000-4000-8000-000000000000", mensaje: "decidí probar", respuesta: "ok" }),
  });
  console.log(`POST sin secreto -> ${prueba.status}. Mirar la ejecución en n8n: tiene que terminar en el nodo 01, sin OpenAI.`);
}

const modo = process.argv[2];
if (modo === "worker") await desactivarWorkerLegado();
else if (modo === "decisiones") await cerrarDecisiones();
else {
  console.error("Uso: node n8n/parches/2026-09-28-webhooks-cerrados.mjs worker|decisiones");
  process.exit(1);
}
