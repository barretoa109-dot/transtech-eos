import test from "node:test";
import assert from "node:assert/strict";

import {
  accionDe,
  extraerTexto,
  juntarResultados,
  tieneError,
  type Base,
  type ResultadoWorker,
} from "./resultados.ts";

function base(extra: Partial<Base> = {}): Base {
  return {
    request_id: "req",
    conversacion_id: "conv",
    respuesta: "Lo dejo listo.",
    documento: null,
    acciones: [],
    accion: "RESPONDER",
    metadata: { plan: "free" },
    tokens_entrada: 10,
    tokens_salida: 5,
    ...extra,
  };
}

const hecho = (accion: string, respuesta = ""): ResultadoWorker => ({
  ok: true,
  executed: true,
  accion,
  ...(respuesta ? { respuesta } : {}),
});

// ---------------------------------------------------------------------------
// Nunca "[object Object]"
// ---------------------------------------------------------------------------

test("saca texto real y nunca convierte un objeto a string", () => {
  assert.equal(extraerTexto({ respuesta: "hola" }), "hola");
  assert.equal(extraerTexto({ resultado: { message: "desde adentro" } }), "desde adentro");
  assert.equal(extraerTexto({ nada: { util: 1 } }), "", "convirtió un objeto en texto");
});

test("un objeto sin texto no ensucia la burbuja del chat", () => {
  const f = juntarResultados(base(), [{ ok: true, executed: true, accion: "CREAR_TAREA", datos: { x: 1 } }]);
  assert.ok(!f.respuesta.includes("[object Object]"));
  assert.equal(f.respuesta, "Lo dejo listo.");
});

test("no se cuelga con nulos ni listas vacías", () => {
  assert.equal(extraerTexto(null), "");
  assert.equal(extraerTexto([]), "");
  assert.equal(extraerTexto(["", "  ", "ok"]), "ok");
});

// ---------------------------------------------------------------------------
// Un reintento no es una segunda ejecución
// ---------------------------------------------------------------------------

test("un comando repetido va a idempotentes, no a ejecutadas", () => {
  // Decir que se ejecutó diría que la venta se cargó dos veces, que es lo
  // contrario de lo que pasó.
  for (const marca of [
    { idempotent: true },
    { command_idempotent: true },
    { decision: "completed" },
  ]) {
    const f = juntarResultados(base(), [
      { ok: true, executed: true, accion: "REGISTRAR_VENTA", ...marca },
    ]);
    assert.deepEqual(f.worker.acciones_ejecutadas, [], `${JSON.stringify(marca)} se contó como ejecución`);
    assert.deepEqual(f.worker.acciones_idempotentes, ["REGISTRAR_VENTA"]);
  }
});

test("una ejecución de verdad sí se cuenta", () => {
  const f = juntarResultados(base(), [hecho("REGISTRAR_VENTA")]);
  assert.deepEqual(f.worker.acciones_ejecutadas, ["REGISTRAR_VENTA"]);
  assert.deepEqual(f.worker.acciones_idempotentes, []);
});

test("estado completada también cuenta como ejecutada", () => {
  const f = juntarResultados(base(), [{ ok: true, estado: "completada", accion: "CREAR_TAREA" }]);
  assert.deepEqual(f.worker.acciones_ejecutadas, ["CREAR_TAREA"]);
});

test("la misma acción dos veces se lista una sola", () => {
  const f = juntarResultados(base(), [hecho("CREAR_TAREA"), hecho("CREAR_TAREA")]);
  assert.deepEqual(f.worker.acciones_ejecutadas, ["CREAR_TAREA"]);
});

// ---------------------------------------------------------------------------
// Los errores se dicen
// ---------------------------------------------------------------------------

test("un error del worker se avisa: el modelo ya prometió que estaba listo", () => {
  const f = juntarResultados(base(), [{ ok: false, accion: "REGISTRAR_VENTA", error: "sin stock" }]);
  assert.ok(f.respuesta.includes("No pude completar automáticamente: REGISTRAR_VENTA"));
  assert.equal(f.worker.ok, false);
  assert.deepEqual(f.worker.errores, [{ accion: "REGISTRAR_VENTA", error: "sin stock" }]);
});

test("un resultado con campo error cuenta como error aunque ok no venga", () => {
  assert.equal(tieneError({ error: "algo" }), true);
  assert.equal(tieneError({ ok: false }), true);
  assert.equal(tieneError({ ok: true }), false);
  assert.equal(tieneError({}), false);
});

test("con varias fallas se nombran todas sin repetir", () => {
  const f = juntarResultados(base(), [
    { ok: false, accion: "CREAR_TAREA", error: "x" },
    { ok: false, accion: "CREAR_TAREA", error: "y" },
    { ok: false, accion: "AJUSTAR_STOCK", error: "z" },
  ]);
  assert.ok(f.respuesta.includes("CREAR_TAREA, AJUSTAR_STOCK"));
});

test("un error sin mensaje legible igual dice algo", () => {
  const f = juntarResultados(base(), [{ ok: false, accion: "CREAR_TAREA" }]);
  assert.equal(f.worker.errores[0].error, "Worker no completado");
});

test("una parte que falla no borra la que anduvo", () => {
  const f = juntarResultados(base(), [
    hecho("CREAR_TAREA", "Tarea creada."),
    { ok: false, accion: "REGISTRAR_VENTA", error: "sin stock" },
  ]);
  assert.ok(f.respuesta.includes("Tarea creada."));
  assert.ok(f.respuesta.includes("No pude completar"));
  assert.deepEqual(f.worker.acciones_ejecutadas, ["CREAR_TAREA"]);
});

// ---------------------------------------------------------------------------
// Cómo se arma el texto
// ---------------------------------------------------------------------------

test("lo que dijo el worker se suma abajo de lo que dijo el modelo", () => {
  const f = juntarResultados(base({ respuesta: "Ahí va." }), [hecho("CREAR_TAREA", "Tarea creada.")]);
  assert.equal(f.respuesta, "Ahí va.\n\nTarea creada.");
});

test("no se repite lo que el modelo ya había dicho", () => {
  const f = juntarResultados(base({ respuesta: "Tarea creada." }), [hecho("CREAR_TAREA", "Tarea creada.")]);
  assert.equal(f.respuesta, "Tarea creada.", "la frase salió dos veces");
});

test("dos workers que dicen lo mismo aportan una sola vez", () => {
  const f = juntarResultados(base({ respuesta: "Ahí va." }), [
    hecho("CREAR_TAREA", "Hecho."),
    hecho("GUARDAR_MEMORIA", "Hecho."),
  ]);
  assert.equal(f.respuesta, "Ahí va.\n\nHecho.");
});

test("RESPONDER no aporta texto: ya lo dijo el modelo", () => {
  const f = juntarResultados(base({ respuesta: "Ahí va." }), [hecho("RESPONDER", "Ahí va otra cosa.")]);
  assert.equal(f.respuesta, "Ahí va.");
});

test("una lectura REEMPLAZA la respuesta en vez de sumarse", () => {
  // Quien pidió el dashboard quiere los números, no la cortesía previa.
  const f = juntarResultados(base({ respuesta: "Te muestro el panel." }), [
    hecho("VER_DASHBOARD", "Ventas: 12.000.000"),
  ]);
  assert.equal(f.respuesta, "Ventas: 12.000.000");
});

test("una lectura no ejecutada no reemplaza nada", () => {
  const f = juntarResultados(base({ respuesta: "Te muestro el panel." }), [
    { ok: true, executed: false, accion: "VER_DASHBOARD", respuesta: "Ventas: 1" },
  ]);
  assert.ok(f.respuesta.startsWith("Te muestro el panel."));
});

test("una lectura conserva lo que dijeron los otros workers", () => {
  const f = juntarResultados(base({ respuesta: "Ya va." }), [
    hecho("VER_DASHBOARD", "Ventas: 100"),
    hecho("CREAR_TAREA", "Tarea creada."),
  ]);
  assert.equal(f.respuesta, "Ventas: 100\n\nTarea creada.");
});

test("sin nada que decir queda un texto usable", () => {
  const f = juntarResultados(base({ respuesta: "" }), []);
  assert.equal(f.respuesta, "Listo.");
});

// ---------------------------------------------------------------------------
// El archivo
// ---------------------------------------------------------------------------

test("el archivo generado cambia el tipo y agrega el enlace", () => {
  const f = juntarResultados(base(), [
    {
      ok: true,
      executed: true,
      accion: "GENERAR_EXCEL",
      archivo_url: "https://x/y.xlsx",
      archivo_tipo: "excel",
      archivo_nombre: "ventas.xlsx",
    },
  ]);

  assert.equal(f.tipo, "archivo");
  assert.equal(f.archivo_url, "https://x/y.xlsx");
  assert.equal(f.archivo_nombre, "ventas.xlsx");
  assert.equal(f.accion, "GENERAR_EXCEL");
  assert.ok(f.respuesta.includes("Descargar archivo: https://x/y.xlsx"));
});

test("el enlace no se repite si ya estaba en el texto", () => {
  const f = juntarResultados(base({ respuesta: "Está en https://x/y.xlsx" }), [
    { ok: true, executed: true, accion: "GENERAR_PDF", archivo_url: "https://x/y.xlsx" },
  ]);
  assert.equal(f.respuesta.match(/https:\/\/x\/y\.xlsx/g)?.length, 1);
});

test("un archivo que falló no se ofrece para descargar", () => {
  const f = juntarResultados(base(), [
    { ok: false, accion: "GENERAR_EXCEL", error: "no se pudo", archivo_url: "https://x/y.xlsx" },
  ]);
  assert.equal(f.tipo, "texto");
  assert.equal(f.archivo_url, "");
  assert.ok(!f.respuesta.includes("Descargar"));
});

// ---------------------------------------------------------------------------
// Lo que se conserva de la base
// ---------------------------------------------------------------------------

test("los tokens y el documento sobreviven al paso por el worker", () => {
  const doc = { titulo: "T", bloques: [] };
  const f = juntarResultados(base({ documento: doc, tokens_entrada: 99, tokens_salida: 7 }), []);
  assert.equal(f.documento, doc);
  assert.equal(f.tokens_entrada, 99);
  assert.equal(f.tokens_salida, 7);
});

test("no se filtra el estado interno del gateway", () => {
  // Antes n8n esparcía todo `base`, incluida la imagen en base64.
  const f = juntarResultados(base(), []);
  const campos = Object.keys(f);
  for (const prohibido of ["imagen_data_url", "prompt_eos", "historial", "contenido_openai"]) {
    assert.ok(!campos.includes(prohibido), `${prohibido} volvió al cliente`);
  }
});

test("la acción de la base se conserva cuando no hubo archivo", () => {
  const f = juntarResultados(base({ accion: "REGISTRAR_VENTA" }), [hecho("REGISTRAR_VENTA")]);
  assert.equal(f.accion, "REGISTRAR_VENTA");
});

test("lee la acción desde sus tres nombres posibles", () => {
  assert.equal(accionDe({ accion: "a" }), "A");
  assert.equal(accionDe({ action: "b" }), "B");
  assert.equal(accionDe({ resultado: { accion: "c" } }), "C");
  assert.equal(accionDe({}), "");
});

test("worker.ok es cierto solo cuando no falló nada", () => {
  assert.equal(juntarResultados(base(), [hecho("CREAR_TAREA")]).worker.ok, true);
  assert.equal(juntarResultados(base(), []).worker.ok, true);
  assert.equal(juntarResultados(base(), [{ ok: false, accion: "X" }]).worker.ok, false);
});
