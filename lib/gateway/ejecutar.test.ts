import test from "node:test";
import assert from "node:assert/strict";

import { ACCIONES_INTERNAS, ejecutarEnProceso } from "./ejecutar.ts";
import { RUTAS, type Job } from "./jobs.ts";
import { ACCIONES_PERMITIDAS } from "./respuesta.ts";

/**
 * Estos tests NO llaman a la base ni a los handlers.
 *
 * `ejecutarEnProceso` orquesta dos handlers reales que abren Supabase con
 * `service_role`; ejercitarlos acá exigiría una base de prueba y convertiría un
 * test de unidad en uno de integración lento y frágil. Lo que sí se puede
 * probar sin base es el REPARTO —qué acción va por qué rama— que es donde
 * mandar una venta por el camino de las lecturas costaría caro.
 *
 * Las ramas internas se prueban de punta a punta con `node certificacion` y
 * con el corpus de `evals/casos/acciones.ts`.
 */

test("las acciones internas son exactamente las que acepta el worker de n8n", () => {
  assert.deepEqual(
    [...ACCIONES_INTERNAS].sort(),
    [
      "AJUSTAR_STOCK",
      "CREAR_CONTACTO",
      "CREAR_OBJETIVO",
      "CREAR_TAREA",
      "GUARDAR_MEMORIA",
      "REGISTRAR_VENTA",
    ],
  );
});

test("toda acción interna va por el webhook interno, y ninguna otra", () => {
  // Si una acción interna cayera en otra rama, se ejecutaría sin pasar por la
  // puerta de autonomía; si una lectura cayera acá, pediría aprobación para
  // mirar un número.
  for (const accion of ACCIONES_PERMITIDAS) {
    const esInterna = ACCIONES_INTERNAS.has(accion);
    const vaAlInterno = RUTAS[accion] === "eos-worker-rc1-internal";
    assert.equal(
      esInterna,
      vaAlInterno,
      `${accion}: interna=${esInterna} pero su ruta es ${RUTAS[accion]}`,
    );
  }
});

test("las tres del negocio están adentro de las internas", () => {
  // Faltaron una vez en la lista del worker y el gate nunca vio un
  // REGISTRAR_VENTA: el chat decía "listo para registrar" y la pantalla de
  // aprobaciones quedaba vacía. Lo reportó una clienta.
  for (const accion of ["REGISTRAR_VENTA", "AJUSTAR_STOCK", "CREAR_CONTACTO"]) {
    assert.ok(ACCIONES_INTERNAS.has(accion), `${accion} quedó fuera otra vez`);
  }
});

test("las lecturas y RESPONDER NO son internas", () => {
  for (const accion of ["VER_DASHBOARD", "VER_BRIEFING", "RESPONDER"]) {
    assert.ok(!ACCIONES_INTERNAS.has(accion), `${accion} pediría autorización para leer`);
  }
});

test("las de archivo tampoco: no se ejecutan por este camino", () => {
  for (const accion of ["GENERAR_EXCEL", "GENERAR_PDF", "GENERAR_WORD"]) {
    assert.ok(!ACCIONES_INTERNAS.has(accion));
  }
});

// ---------------------------------------------------------------------------
// El flujo, con puertas de mentira
// ---------------------------------------------------------------------------

function job(tipo: string, datos: Record<string, unknown> = {}): Job {
  return {
    request_id: "11111111-1111-4111-8111-111111111111",
    usuario_id: "22222222-2222-4222-9222-222222222222",
    usuario_id_original: "22222222-2222-4222-9222-222222222222",
    usuario_key: "22222222-2222-4222-9222-222222222222",
    conversacion_id: "33333333-3333-4333-a333-333333333333",
    nombre: "Marta",
    plan: "free",
    origen: "eos-web",
    mensaje: "vendí 3 panes",
    respuesta_gateway: "Lo dejo listo para que confirmes.",
    accion: { tipo, datos },
    action_index: 0,
    action_count: 1,
    worker_path: RUTAS[tipo] ?? "",
    sin_acciones: false,
    historial: [],
    metadata: { plan: "free", origen: "eos-web" },
    received_at: "2026-09-04T12:00:00.000Z",
  };
}

const COMANDO = "44444444-4444-4444-8444-444444444444";

/** Puertas que devuelven lo que se les diga, y anotan lo que recibieron. */
function puertasDe(
  auth: unknown,
  efecto: unknown = { ok: true, command_id: COMANDO, estado: "completada" },
) {
  const recibido: { autorizar?: unknown; efecto?: unknown } = {};
  const responder = (cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  return {
    recibido,
    puertas: {
      autorizar: async (r: Request) => {
        recibido.autorizar = await r.json();
        return responder(auth);
      },
      efecto: async (r: Request) => {
        recibido.efecto = await r.json();
        return responder(efecto);
      },
    },
  };
}

/** Con el secreto puesto mientras corre. */
async function conSecreto<T>(correr: () => Promise<T>): Promise<T> {
  const previo = process.env.EOS_WORKER_GATE_SECRET;
  process.env.EOS_WORKER_GATE_SECRET = "sec-de-prueba";
  try {
    return await correr();
  } finally {
    if (previo === undefined) delete process.env.EOS_WORKER_GATE_SECRET;
    else process.env.EOS_WORKER_GATE_SECRET = previo;
  }
}

test("RESPONDER devuelve el texto del modelo sin tocar ninguna puerta", async () => {
  const { puertas, recibido } = puertasDe({ ok: true, execute: true, command_id: COMANDO });
  const r = await ejecutarEnProceso(job("RESPONDER"), puertas);

  assert.equal(r.ok, true);
  assert.equal(r.executed, false);
  assert.equal(r.respuesta, "Lo dejo listo para que confirmes.");
  assert.equal(recibido.autorizar, undefined, "pidió autorización para no hacer nada");
});

test("una acción interna autorizada se ejecuta y lo dice con sus palabras", async () => {
  const { recibido } = await conSecreto(async () => {
    const p = puertasDe({ ok: true, execute: true, command_id: COMANDO });
    const r = await ejecutarEnProceso(job("REGISTRAR_VENTA", { items: [] }), p.puertas);

    assert.equal(r.ok, true);
    assert.equal(r.executed, true);
    assert.equal(r.respuesta, "La venta quedó registrada. La ves en Negocio > Ventas.");
    assert.equal(r.command_id, COMANDO);
    return p;
  });

  // El efecto se pide por command_id, no remandando el payload: si se
  // remandara, un cambio entre las dos llamadas ejecutaría otra cosa.
  assert.deepEqual(recibido.efecto, { command_id: COMANDO });
  assert.ok(recibido.autorizar, "no pidió autorización antes de ejecutar");
});

test("la huella que se manda a autorizar tiene la forma exacta de n8n", async () => {
  const { recibido } = await conSecreto(async () => {
    const p = puertasDe({ ok: true, execute: true, command_id: COMANDO });
    await ejecutarEnProceso(job("CREAR_TAREA", { titulo: "X" }), p.puertas);
    return p;
  });

  const enviado = recibido.autorizar as Record<string, unknown>;
  assert.deepEqual(Object.keys(enviado.payload as object).sort(), ["datos", "mensaje", "metadata"]);
  assert.equal((enviado.payload as Record<string, unknown>).mensaje, "vendí 3 panes");
  assert.equal(enviado.accion, "CREAR_TAREA");
});

test("sin secreto no se autoriza nada y se dice por qué", async () => {
  const previo = process.env.EOS_WORKER_GATE_SECRET;
  delete process.env.EOS_WORKER_GATE_SECRET;
  try {
    const { puertas, recibido } = puertasDe({ ok: true, execute: true, command_id: COMANDO });
    const r = await ejecutarEnProceso(job("REGISTRAR_VENTA"), puertas);

    assert.equal(r.ok, false);
    assert.ok(String(r.error).includes("EOS_WORKER_GATE_SECRET"));
    assert.equal(recibido.autorizar, undefined, "intentó autorizar sin secreto");
  } finally {
    if (previo !== undefined) process.env.EOS_WORKER_GATE_SECRET = previo;
  }
});

test("esperar aprobación NO es un error", async () => {
  // Mostrarlo como fallo asusta a quien pidió algo que el sistema está
  // haciendo bien: guardarlo para que lo apruebe.
  await conSecreto(async () => {
    const { puertas } = puertasDe({ ok: true, execute: false, decision: "approval" });
    const r = await ejecutarEnProceso(job("REGISTRAR_VENTA"), puertas);

    assert.equal(r.ok, true, "una aprobación pendiente se reportó como error");
    assert.equal(r.executed, false);
    assert.equal(r.respuesta, "Esta acción requiere aprobación antes de ejecutarse.");
  });
});

test("una acción ya completada no se repite y se marca idempotente", async () => {
  await conSecreto(async () => {
    const { puertas, recibido } = puertasDe({ ok: true, execute: false, decision: "completed" });
    const r = await ejecutarEnProceso(job("REGISTRAR_VENTA"), puertas);

    assert.equal(r.idempotent, true);
    assert.equal(r.estado, "completada");
    assert.equal(r.respuesta, "Esta acción ya había sido completada y no se repitió.");
    assert.equal(recibido.efecto, undefined, "volvió a ejecutar un comando ya completado");
  });
});

test("un bloqueo de la puerta se reporta como error con su motivo", async () => {
  await conSecreto(async () => {
    const { puertas } = puertasDe({ ok: false, decision: "block", reason: "cupo diario agotado" });
    const r = await ejecutarEnProceso(job("AJUSTAR_STOCK"), puertas);

    assert.equal(r.ok, false);
    assert.equal(r.respuesta, "cupo diario agotado");
  });
});

test("si el efecto falla, se dice y no se inventa que quedó hecho", async () => {
  await conSecreto(async () => {
    const { puertas } = puertasDe(
      { ok: true, execute: true, command_id: COMANDO },
      { ok: false, error: "no hay stock suficiente" },
    );
    const r = await ejecutarEnProceso(job("REGISTRAR_VENTA"), puertas);

    assert.equal(r.ok, false);
    assert.equal(r.executed, false);
    assert.equal(r.respuesta, "no hay stock suficiente");
  });
});

test("los archivos no se ejecutan por acá y lo explican", async () => {
  for (const tipo of ["GENERAR_EXCEL", "GENERAR_PDF", "GENERAR_WORD"]) {
    const { puertas } = puertasDe({ ok: true, execute: true, command_id: COMANDO });
    const r = await ejecutarEnProceso(job(tipo), puertas);

    assert.equal(r.ok, false);
    assert.ok(String(r.error).includes("documento"), `${tipo} no explicó por dónde sí`);
  }
});
