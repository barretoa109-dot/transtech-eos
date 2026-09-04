import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  AccionNoPermitida,
  RUTAS,
  armarJobs,
  importancia,
  metadataEstable,
  normalizarDatos,
  prioridad,
} from "./jobs.ts";
import { ACCIONES_PERMITIDAS, prepararRespuesta } from "./respuesta.ts";
import { prepararEntrada, type Entrada } from "./entrada.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

function entrada(extra: Record<string, unknown> = {}): Entrada {
  return prepararEntrada({
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "vendí 3 panes",
    fecha: "2026-09-03T12:00:00.000Z",
    ...extra,
  });
}

/** Una respuesta del modelo con las acciones que se le pasen. */
function respuesta(acciones: unknown[], respuestaTexto = "Lo dejo listo.") {
  return prepararRespuesta(entrada(), {
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: JSON.stringify({ respuesta: respuestaTexto, acciones }) },
        ],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

/** La misma huella que calcula el Worker Gate. */
function huella(valor: unknown): string {
  const estable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(estable);
    if (!v || typeof v !== "object") return v;
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = estable((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  };
  return createHash("sha256").update(JSON.stringify(estable(valor))).digest("hex");
}

// ---------------------------------------------------------------------------
// Exact-once: lo que no puede cambiar
// ---------------------------------------------------------------------------

test("los alias del modelo dan la MISMA huella", () => {
  // Cuatro formas de decir lo mismo. Si dieran huellas distintas, el gate no
  // reconocería el reintento y la tarea se crearía dos veces.
  const formas = [
    { titulo: "Llamar a Ana", descripcion: "por el pedido" },
    { nombre: "Llamar a Ana", description: "por el pedido" },
    { name: "Llamar a Ana", detalle: "por el pedido" },
    { asunto: "Llamar a Ana", detalles: "por el pedido" },
  ];

  const huellas = new Set(formas.map((d) => huella(normalizarDatos("CREAR_TAREA", d))));
  assert.equal(huellas.size, 1, "los alias produjeron huellas distintas");
});

test("dos intenciones distintas dan huellas distintas", () => {
  const a = huella(normalizarDatos("CREAR_TAREA", { titulo: "Llamar a Ana" }));
  const b = huella(normalizarDatos("CREAR_TAREA", { titulo: "Llamar a Beto" }));
  assert.notEqual(a, b, "canonicalizar de más borró la diferencia entre dos tareas");
});

test("el job NO lleva nada que cambie entre dos llamadas a OpenAI", () => {
  const [job] = armarJobs(entrada(), respuesta([{ tipo: "REGISTRAR_VENTA", datos: { items: [] } }]));
  const texto = JSON.stringify(job).toLowerCase();

  for (const volatil of ["openai_response_id", "openai_status", "openai_model", "resp_"]) {
    assert.ok(!texto.includes(volatil), `"${volatil}" entró al job y rompería los reintentos`);
  }
});

test("dos ejecuciones del mismo mensaje producen el mismo job", () => {
  // La única diferencia entre dos llamadas es lo que devuelve OpenAI; el job
  // tiene que salir idéntico igual.
  const e = entrada();
  const uno = armarJobs(e, respuesta([{ tipo: "CREAR_TAREA", datos: { titulo: "X" } }], "Ahí va."));
  const dos = armarJobs(e, respuesta([{ tipo: "CREAR_TAREA", datos: { nombre: "X" } }], "Listo."));

  // La respuesta conversacional puede cambiar y por eso está fuera de la huella.
  assert.notEqual(uno[0].respuesta_gateway, dos[0].respuesta_gateway);
  assert.equal(huella(uno[0].accion), huella(dos[0].accion));
});

// ---------------------------------------------------------------------------
// La normalización, campo por campo
// ---------------------------------------------------------------------------

test("CREAR_TAREA lleva exactamente cuatro campos", () => {
  const d = normalizarDatos("CREAR_TAREA", { titulo: "T", inventado: "x" });
  assert.deepEqual(Object.keys(d).sort(), ["descripcion", "fecha_limite", "prioridad", "titulo"]);
  assert.ok(!("inventado" in d), "un campo de más cambia la huella");
});

test("el orden de preferencia de los alias es el de n8n", () => {
  // Si `nombre` le ganara a `titulo`, huellas ya emitidas dejarían de coincidir.
  const d = normalizarDatos("CREAR_TAREA", { titulo: "gana", nombre: "pierde", name: "pierde" });
  assert.equal(d.titulo, "gana");
});

test("los campos que faltan quedan en cadena vacía, no en undefined", () => {
  const d = normalizarDatos("CREAR_TAREA", {});
  assert.equal(d.titulo, "");
  assert.equal(d.descripcion, "");
  assert.equal(d.fecha_limite, "");
});

test("GUARDAR_MEMORIA normaliza sus alias", () => {
  const d = normalizarDatos("GUARDAR_MEMORIA", { texto: "algo", category: "negocio" });
  assert.equal(d.contenido, "algo");
  assert.equal(d.categoria, "negocio");
  assert.equal(d.importancia, 5);
});

test("los archivos normalizan tema y negocio", () => {
  const d = normalizarDatos("GENERAR_EXCEL", { asunto: "ventas", empresa: "Panadería" });
  assert.equal(d.tema, "ventas");
  assert.equal(d.negocio, "Panadería");
});

test("las tres del negocio pasan sus datos tal cual", () => {
  // Su contrato lo valida el worker; recortarlo acá perdería los ítems.
  const items = [{ producto: "pan", cantidad: 3 }];
  for (const tipo of ["REGISTRAR_VENTA", "AJUSTAR_STOCK", "CREAR_CONTACTO"]) {
    const d = normalizarDatos(tipo, { items, contacto: "Ana" });
    assert.deepEqual(d.items, items, `${tipo} perdió sus datos`);
    assert.equal(d.contacto, "Ana");
  }
});

test("las lecturas y RESPONDER no llevan datos", () => {
  for (const tipo of ["VER_DASHBOARD", "VER_BRIEFING", "RESPONDER"]) {
    assert.deepEqual(normalizarDatos(tipo, { basura: 1 }), {}, `${tipo} arrastró datos`);
  }
});

test("unos datos que no son objeto no rompen", () => {
  assert.deepEqual(normalizarDatos("CREAR_TAREA", null).titulo, "");
  assert.deepEqual(normalizarDatos("CREAR_TAREA", ["x"]).titulo, "");
  assert.deepEqual(normalizarDatos("CREAR_TAREA", "hola").titulo, "");
});

test("un número sirve como texto: el modelo a veces manda 2026 sin comillas", () => {
  assert.equal(normalizarDatos("CREAR_TAREA", { titulo: 2026 }).titulo, "2026");
});

// ---------------------------------------------------------------------------
// Los rangos
// ---------------------------------------------------------------------------

test("la prioridad se recorta a 1..5 y cae en 3 cuando no es número", () => {
  assert.equal(prioridad(0), 1);
  assert.equal(prioridad(9), 5);
  assert.equal(prioridad(2.6), 3);
  assert.equal(prioridad("alta"), 3);
  assert.equal(prioridad(undefined), 3);
});

test("la importancia se recorta a 1..10 y cae en 5", () => {
  assert.equal(importancia(-4), 1);
  assert.equal(importancia(99), 10);
  assert.equal(importancia("mucha"), 5);
});

// ---------------------------------------------------------------------------
// El job
// ---------------------------------------------------------------------------

test("cada acción de la lista blanca tiene su ruta", () => {
  // El día que alguien agregue una acción y se olvide de la ruta, esto grita.
  for (const accion of ACCIONES_PERMITIDAS) {
    assert.ok(RUTAS[accion], `${accion} está permitida pero no tiene worker_path`);
  }
});

test("una acción sin ruta se rechaza en vez de mandarse a ningún lado", () => {
  const falsa = { ...respuesta([]), acciones: [{ tipo: "ENVIAR_EMAIL", datos: {} }], requiere_worker: true };
  assert.throws(() => armarJobs(entrada(), falsa), AccionNoPermitida);
});

test("sin acciones se fabrica un RESPONDER marcado", () => {
  const jobs = armarJobs(entrada(), respuesta([]));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].accion.tipo, "RESPONDER");
  assert.equal(jobs[0].sin_acciones, true, "sin la marca no se puede saltear la vuelta al worker");
  assert.equal(jobs[0].worker_path, "eos-worker-rc1-respond");
});

test("con acciones la marca es falsa y hay un job por acción", () => {
  const jobs = armarJobs(
    entrada(),
    respuesta([
      { tipo: "REGISTRAR_VENTA", datos: { items: [] } },
      { tipo: "CREAR_TAREA", datos: { titulo: "avisar" } },
    ]),
  );

  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.action_index), [0, 1]);
  assert.deepEqual(jobs.map((j) => j.action_count), [2, 2]);
  assert.ok(jobs.every((j) => j.sin_acciones === false));
});

test("el job arrastra la identidad del pedido sin cambiarla", () => {
  const [job] = armarJobs(entrada(), respuesta([{ tipo: "CREAR_TAREA", datos: {} }]));
  assert.equal(job.request_id, UUID_A);
  assert.equal(job.usuario_id, UUID_B);
  assert.equal(job.usuario_id_original, UUID_B);
  assert.equal(job.usuario_key, UUID_B);
  assert.equal(job.conversacion_id, UUID_C);
  assert.equal(job.mensaje, "vendí 3 panes", "el mensaje original tiene que llegar intacto");
});

test("received_at sale de la fecha del pedido y es igual en los dos jobs", () => {
  const jobs = armarJobs(
    entrada(),
    respuesta([{ tipo: "CREAR_TAREA", datos: {} }, { tipo: "GUARDAR_MEMORIA", datos: {} }]),
  );
  assert.equal(jobs[0].received_at, "2026-09-03T12:00:00.000Z");
  assert.equal(jobs[0].received_at, jobs[1].received_at);
});

test("las tres del negocio van por el camino interno", () => {
  for (const tipo of ["REGISTRAR_VENTA", "AJUSTAR_STOCK", "CREAR_CONTACTO"]) {
    assert.equal(RUTAS[tipo], "eos-worker-rc1-internal");
  }
});

// ---------------------------------------------------------------------------
// La metadata
// ---------------------------------------------------------------------------

test("la metadata del job es estable y no arrastra la de OpenAI", () => {
  const m = metadataEstable(entrada({ plan: "pro" }));
  assert.deepEqual(Object.keys(m).sort(), [
    "archivo_entrada_nombre",
    "archivo_entrada_tipo",
    "imagen_analizada",
    "origen",
    "plan",
    "tiene_archivo",
  ]);
  assert.equal(m.plan, "pro");
});

test("la metadata refleja la imagen adjunta", () => {
  const m = metadataEstable(entrada({ archivo: { nombre: "t.png", tipo: "image/png", base64: "A" } }));
  assert.equal(m.tiene_archivo, true);
  assert.equal(m.imagen_analizada, true);
  assert.equal(m.archivo_entrada_nombre, "t.png");
});

test("un pdf no cuenta como imagen analizada", () => {
  const m = metadataEstable(
    entrada({ archivo: { nombre: "a.pdf", tipo: "application/pdf", base64: "A" } }),
  );
  assert.equal(m.imagen_analizada, false);
});

// ---------------------------------------------------------------------------
// El base64 no puede viajar al worker
// ---------------------------------------------------------------------------

test("la imagen NO viaja adentro del job", () => {
  // Una foto de 8 MB dando la vuelta a n8n para ser descartada allá es el
  // mismo derroche que ya se había sacado del nodo 08.
  const [job] = armarJobs(
    entrada({ archivo: { nombre: "t.png", tipo: "image/png", base64: "A".repeat(5000) } }),
    respuesta([{ tipo: "CREAR_TAREA", datos: {} }]),
  );
  assert.ok(!JSON.stringify(job).includes("A".repeat(100)), "el base64 se coló en el job");
});
