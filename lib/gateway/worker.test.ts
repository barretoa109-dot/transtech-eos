import test from "node:test";
import assert from "node:assert/strict";

import { configDelWorker, ejecutarJob, ejecutarJobs, workerEnProceso } from "./worker.ts";
import { armarJobs, type Job } from "./jobs.ts";
import { prepararEntrada } from "./entrada.ts";
import { prepararRespuesta } from "./respuesta.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

const CONFIG = { base: "https://n8n.ejemplo", secreto: "sec" };

function jobs(acciones: unknown[]): Job[] {
  const entrada = prepararEntrada({
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "hola",
    fecha: "2026-09-03T12:00:00.000Z",
  });

  const respuesta = prepararRespuesta(entrada, {
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ respuesta: "ok", acciones }) }],
      },
    ],
  });

  return armarJobs(entrada, respuesta);
}

type Llamada = { url: string; headers: Record<string, string>; body: unknown };

/** Corre algo con un n8n de mentira y devuelve lo que se le mandó. */
async function conWorkerFalso<T>(
  responder: (llamada: Llamada, n: number) => Response | Promise<Response>,
  correr: () => Promise<T>,
): Promise<{ salida: T; llamadas: Llamada[] }> {
  const original = globalThis.fetch;
  const llamadas: Llamada[] = [];

  globalThis.fetch = (async (url: unknown, opciones?: { headers?: Record<string, string>; body?: string }) => {
    const llamada = {
      url: String(url),
      headers: opciones?.headers ?? {},
      body: opciones?.body ? JSON.parse(opciones.body) : null,
    };
    llamadas.push(llamada);
    return responder(llamada, llamadas.length);
  }) as unknown as typeof fetch;

  try {
    return { salida: await correr(), llamadas };
  } finally {
    globalThis.fetch = original;
  }
}

const ok = (cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });

// ---------------------------------------------------------------------------
// La configuración
// ---------------------------------------------------------------------------

test("sin las dos variables la etapa 2 no está configurada", () => {
  const base = process.env.EOS_N8N_BASE_URL;
  const sec = process.env.EOS_WORKER_GATE_SECRET;
  try {
    delete process.env.EOS_N8N_BASE_URL;
    delete process.env.EOS_WORKER_GATE_SECRET;
    assert.equal(configDelWorker(), null);

    process.env.EOS_N8N_BASE_URL = "https://x";
    assert.equal(configDelWorker(), null, "con la url pero sin secreto no alcanza");

    process.env.EOS_WORKER_GATE_SECRET = "s";
    assert.deepEqual(configDelWorker(), { base: "https://x", secreto: "s" });

    // La barra final se saca: si no, la URL queda con doble barra.
    process.env.EOS_N8N_BASE_URL = "https://x/";
    assert.equal(configDelWorker()?.base, "https://x");
  } finally {
    if (base === undefined) delete process.env.EOS_N8N_BASE_URL;
    else process.env.EOS_N8N_BASE_URL = base;
    if (sec === undefined) delete process.env.EOS_WORKER_GATE_SECRET;
    else process.env.EOS_WORKER_GATE_SECRET = sec;
  }
});

// ---------------------------------------------------------------------------
// Cómo se llama al worker
// ---------------------------------------------------------------------------

test("cada acción va a su webhook, con el secreto", async () => {
  const [job] = jobs([{ tipo: "REGISTRAR_VENTA", datos: { items: [] } }]);

  const { llamadas } = await conWorkerFalso(
    () => ok({ ok: true, executed: true, accion: "REGISTRAR_VENTA" }),
    () => ejecutarJob(job, CONFIG),
  );

  assert.equal(llamadas[0].url, "https://n8n.ejemplo/webhook/eos-worker-rc1-internal");
  assert.equal(llamadas[0].headers.Authorization, "Bearer sec");
});

test("el job viaja entero al worker", async () => {
  const [job] = jobs([{ tipo: "CREAR_TAREA", datos: { titulo: "X" } }]);

  const { llamadas } = await conWorkerFalso(
    () => ok({ ok: true }),
    () => ejecutarJob(job, CONFIG),
  );

  const enviado = llamadas[0].body as Job;
  assert.equal(enviado.request_id, UUID_A);
  assert.deepEqual(enviado.accion, { tipo: "CREAR_TAREA", datos: job.accion.datos });
});

test("un resultado envuelto en lista se desenvuelve", async () => {
  // n8n devuelve a veces `[{...}]` en vez del objeto.
  const [job] = jobs([{ tipo: "CREAR_TAREA", datos: {} }]);
  const { salida } = await conWorkerFalso(
    () => ok([{ ok: true, executed: true, accion: "CREAR_TAREA" }]),
    () => ejecutarJob(job, CONFIG),
  );
  assert.equal(salida.executed, true);
  assert.equal(salida.accion, "CREAR_TAREA");
});

// ---------------------------------------------------------------------------
// Lo que sale mal se REPORTA, no se reintenta
// ---------------------------------------------------------------------------

test("un error del worker vuelve como resultado, no como excepción", async () => {
  const [job] = jobs([{ tipo: "REGISTRAR_VENTA", datos: {} }]);

  for (const romper of [
    () => new Response("", { status: 500 }),
    () => new Response("", { status: 401 }),
    () => new Response("<html>", { status: 200 }),
    () => {
      throw new Error("ECONNRESET");
    },
  ]) {
    const { salida } = await conWorkerFalso(romper, () => ejecutarJob(job, CONFIG));
    assert.equal(salida.ok, false, "un fallo del worker no se reportó");
    assert.equal(salida.accion, "REGISTRAR_VENTA", "sin la acción no se sabe qué falló");
    assert.ok(typeof salida.error === "string" && salida.error.length > 0);
  }
});

test("un 200 ilegible se reporta como error: el efecto puede haber ocurrido", async () => {
  const [job] = jobs([{ tipo: "REGISTRAR_VENTA", datos: {} }]);
  const { salida, llamadas } = await conWorkerFalso(
    () => new Response("no soy json", { status: 200 }),
    () => ejecutarJob(job, CONFIG),
  );
  assert.equal(salida.ok, false);
  assert.equal(llamadas.length, 1, "se reintentó un job cuyo efecto pudo haber ocurrido");
});

test("nunca se reintenta un job", async () => {
  const [job] = jobs([{ tipo: "REGISTRAR_VENTA", datos: {} }]);
  const { llamadas } = await conWorkerFalso(
    () => new Response("", { status: 503 }),
    () => ejecutarJob(job, CONFIG),
  );
  assert.equal(llamadas.length, 1, "un reintento automático puede cargar la venta dos veces");
});

// ---------------------------------------------------------------------------
// Varios jobs
// ---------------------------------------------------------------------------

test("los jobs van de a uno y en el orden en que se pidieron", async () => {
  const lista = jobs([
    { tipo: "REGISTRAR_VENTA", datos: { items: [] } },
    { tipo: "AJUSTAR_STOCK", datos: { producto: "pan", delta: -3 } },
  ]);

  const { llamadas } = await conWorkerFalso(
    () => ok({ ok: true, executed: true }),
    () => ejecutarJobs(lista, CONFIG),
  );

  assert.equal(llamadas.length, 2);
  assert.deepEqual(
    llamadas.map((l) => (l.body as Job).accion.tipo),
    ["REGISTRAR_VENTA", "AJUSTAR_STOCK"],
  );
});

test("si el primero falla, el segundo igual se intenta", async () => {
  // Cortar dejaría la mitad hecha sin decir cuál mitad.
  const lista = jobs([
    { tipo: "CREAR_TAREA", datos: { titulo: "a" } },
    { tipo: "GUARDAR_MEMORIA", datos: { contenido: "b" } },
  ]);

  const { salida, llamadas } = await conWorkerFalso(
    (_l, n) => (n === 1 ? new Response("", { status: 500 }) : ok({ ok: true, executed: true })),
    () => ejecutarJobs(lista, CONFIG),
  );

  assert.equal(llamadas.length, 2);
  assert.equal(salida[0].ok, false);
  assert.equal(salida[1].ok, true);
});

test("devuelve un resultado por cada job, siempre", async () => {
  const lista = jobs([
    { tipo: "CREAR_TAREA", datos: {} },
    { tipo: "GUARDAR_MEMORIA", datos: {} },
    { tipo: "VER_DASHBOARD", datos: {} },
  ]);
  const { salida } = await conWorkerFalso(
    () => new Response("", { status: 500 }),
    () => ejecutarJobs(lista, CONFIG),
  );
  assert.equal(salida.length, 3);
});

// ---------------------------------------------------------------------------
// Etapa 3: adentro del proceso
// ---------------------------------------------------------------------------

/** Prende la etapa 3 mientras corre `correr`. */
async function conEtapa3<T>(correr: () => Promise<T>): Promise<T> {
  const previo = process.env.EOS_GATEWAY_TS_WORKER;
  process.env.EOS_GATEWAY_TS_WORKER = "1";
  try {
    return await correr();
  } finally {
    if (previo === undefined) delete process.env.EOS_GATEWAY_TS_WORKER;
    else process.env.EOS_GATEWAY_TS_WORKER = previo;
  }
}

test("la etapa 3 tiene su propia bandera", () => {
  const previo = process.env.EOS_GATEWAY_TS_WORKER;
  try {
    delete process.env.EOS_GATEWAY_TS_WORKER;
    assert.equal(workerEnProceso(), false);

    process.env.EOS_GATEWAY_TS_WORKER = "0";
    assert.equal(workerEnProceso(), false);

    process.env.EOS_GATEWAY_TS_WORKER = "1";
    assert.equal(workerEnProceso(), true);
  } finally {
    if (previo === undefined) delete process.env.EOS_GATEWAY_TS_WORKER;
    else process.env.EOS_GATEWAY_TS_WORKER = previo;
  }
});

test("con la etapa 3 prendida NO se sale a la red", async () => {
  const [job] = jobs([]); // RESPONDER: no toca ninguna puerta
  const { salida, llamadas } = await conWorkerFalso(
    () => ok({ ok: true }),
    () => conEtapa3(() => ejecutarJob(job, CONFIG)),
  );

  assert.equal(llamadas.length, 0, "llamó a n8n teniendo el worker adentro");
  assert.equal(salida.ok, true);
  assert.equal(salida.accion, "RESPONDER");
});

test("con la etapa 3 prendida ya no hace falta la config de n8n", async () => {
  const [job] = jobs([]);
  const salida = await conEtapa3(() => ejecutarJob(job, null));
  assert.equal(salida.ok, true);
});

test("sin etapa 3 y sin config, no manda el job a ninguna parte", async () => {
  const [job] = jobs([{ tipo: "REGISTRAR_VENTA", datos: {} }]);
  const { salida, llamadas } = await conWorkerFalso(
    () => ok({ ok: true }),
    () => ejecutarJob(job, null),
  );

  assert.equal(llamadas.length, 0, "intentó mandar un job a una URL vacía");
  assert.equal(salida.ok, false);
});
