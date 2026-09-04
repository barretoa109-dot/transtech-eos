import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCIONES_PERMITIDAS,
  SIN_INTERPRETAR,
  extraerTexto,
  prepararRespuesta,
  sinCercos,
} from "./respuesta.ts";
import { prepararEntrada, type Entrada } from "./entrada.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

function entrada(extra: Record<string, unknown> = {}): Entrada {
  return prepararEntrada({
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "hola",
    ...extra,
  });
}

/** Una respuesta de la Responses API con el texto que se le pase. */
function ai(texto: string, extra: Record<string, unknown> = {}) {
  return {
    id: "resp_1",
    status: "completed",
    model: "gpt-5.5",
    output: [{ type: "message", content: [{ type: "output_text", text: texto }] }],
    usage: { input_tokens: 120, output_tokens: 45 },
    ...extra,
  };
}

const OK = JSON.stringify({ respuesta: "Todo bien.", acciones: [] });

// ---------------------------------------------------------------------------
// Encontrar el texto
// ---------------------------------------------------------------------------

test("saca el texto por el camino bueno de la Responses API", () => {
  assert.equal(extraerTexto(ai("hola")), "hola");
});

test("los formatos alternativos siguen funcionando", () => {
  assert.equal(extraerTexto({ output_text: "a" }), "a");
  assert.equal(extraerTexto({ text: "b" }), "b");
  assert.equal(extraerTexto({ respuesta: "c" }), "c");
  assert.equal(extraerTexto({ response: "d" }), "d");
  assert.equal(extraerTexto({ message: "e" }), "e");
  // `content` suelto, sin el envoltorio `output`: se baja por recursión.
  assert.equal(extraerTexto({ content: [{ type: "output_text", text: "f" }] }), "f");
  assert.equal(extraerTexto("g"), "g");
});

test("no se cuelga con nulos ni con formas raras", () => {
  assert.equal(extraerTexto(null), "");
  assert.equal(extraerTexto(undefined), "");
  assert.equal(extraerTexto(42), "");
  assert.equal(extraerTexto([]), "");
  assert.equal(extraerTexto({}), "");
});

test("de una lista se queda con el primer texto no vacío", () => {
  assert.equal(extraerTexto(["", "   ", "hola", "chau"]), "hola");
});

// ---------------------------------------------------------------------------
// Los cercos de código
// ---------------------------------------------------------------------------

test("saca los cercos que el modelo agrega de vez en cuando", () => {
  assert.equal(sinCercos('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(sinCercos("```js\nx\n```"), "x");
  assert.equal(sinCercos("```javascript\ny\n```"), "y");
  assert.equal(sinCercos("sin cercos"), "sin cercos");
});

test("un JSON envuelto en cercos igual se parsea", () => {
  const r = prepararRespuesta(entrada(), ai('```json\n{"respuesta":"hola","acciones":[]}\n```'));
  assert.equal(r.respuesta, "hola");
});

// ---------------------------------------------------------------------------
// Cuando el modelo no devuelve JSON
// ---------------------------------------------------------------------------

test("si el modelo contesta prosa, se usa la prosa y no se rompe nada", () => {
  const r = prepararRespuesta(entrada(), ai("Buenas, ¿en qué te ayudo?"));
  assert.equal(r.respuesta, "Buenas, ¿en qué te ayudo?");
  assert.deepEqual(r.acciones, []);
  assert.equal(r.requiere_worker, false);
});

test("un JSON válido que no es objeto se trata como prosa", () => {
  assert.equal(prepararRespuesta(entrada(), ai("42")).respuesta, "42");
  assert.equal(prepararRespuesta(entrada(), ai("[1,2]")).respuesta, "[1,2]");
});

test("sin nada que leer se avisa en vez de mandar vacío", () => {
  assert.equal(prepararRespuesta(entrada(), ai("")).respuesta, SIN_INTERPRETAR);
  assert.equal(prepararRespuesta(entrada(), {}).respuesta, SIN_INTERPRETAR);
});

test("un JSON sin respuesta usable cae al texto de reserva", () => {
  const r = prepararRespuesta(entrada(), ai(JSON.stringify({ respuesta: "  ", acciones: [] })));
  assert.equal(r.respuesta, "Recibí tu solicitud.");
});

// ---------------------------------------------------------------------------
// La lista blanca
// ---------------------------------------------------------------------------

test("una acción inventada se descarta sin frenar la conversación", () => {
  const r = prepararRespuesta(
    entrada(),
    ai(
      JSON.stringify({
        respuesta: "Listo.",
        acciones: [{ tipo: "ENVIAR_EMAIL", datos: { a: "x@y.com" } }],
      }),
    ),
  );
  assert.deepEqual(r.acciones, []);
  assert.equal(r.respuesta, "Listo.", "la persona igual recibe su respuesta");
  assert.equal(r.requiere_worker, false);
});

test("las acciones permitidas pasan y normalizan el tipo", () => {
  const r = prepararRespuesta(
    entrada(),
    ai(
      JSON.stringify({
        respuesta: "Lo dejo listo.",
        acciones: [{ tipo: " registrar_venta ", datos: { items: [] } }],
      }),
    ),
  );
  assert.equal(r.acciones.length, 1);
  assert.equal(r.acciones[0].tipo, "REGISTRAR_VENTA");
  assert.equal(r.requiere_worker, true);
  assert.equal(r.accion, "REGISTRAR_VENTA");
});

test("la lista blanca es exactamente la de n8n", () => {
  assert.deepEqual(
    [...ACCIONES_PERMITIDAS].sort(),
    [
      "AJUSTAR_STOCK",
      "CREAR_CONTACTO",
      "CREAR_OBJETIVO",
      "CREAR_TAREA",
      "GENERAR_EXCEL",
      "GENERAR_PDF",
      "GENERAR_WORD",
      "GUARDAR_MEMORIA",
      "VER_BRIEFING",
      "VER_DASHBOARD",
      "REGISTRAR_VENTA",
    ].sort(),
  );
});

test("unos datos que no son objeto quedan en objeto vacío, no en null", () => {
  const r = prepararRespuesta(
    entrada(),
    ai(JSON.stringify({ respuesta: "x", acciones: [{ tipo: "CREAR_TAREA", datos: "hola" }] })),
  );
  assert.deepEqual(r.acciones[0].datos, {});
});

test("acciones que no son lista no rompen", () => {
  const r = prepararRespuesta(entrada(), ai(JSON.stringify({ respuesta: "x", acciones: "ninguna" })));
  assert.deepEqual(r.acciones, []);
});

// ---------------------------------------------------------------------------
// El documento
// ---------------------------------------------------------------------------

test("un documento bien formado pasa", () => {
  const r = prepararRespuesta(
    entrada(),
    ai(
      JSON.stringify({
        respuesta: "Te armo la planilla.",
        documento: { titulo: "Ventas", bloques: [{ tipo: "parrafo", texto: "x" }] },
        acciones: [],
      }),
    ),
  );
  assert.ok(r.documento);
  assert.equal(r.documento?.titulo, "Ventas");
});

test("con documento se descartan las acciones de generar archivo", () => {
  // Si no, la persona recibe DOS archivos por un solo pedido: el que armó EOS
  // y la plantilla genérica del worker.
  const r = prepararRespuesta(
    entrada(),
    ai(
      JSON.stringify({
        respuesta: "Ahí va.",
        documento: { titulo: "T", bloques: [] },
        acciones: [{ tipo: "GENERAR_EXCEL", datos: {} }, { tipo: "CREAR_TAREA", datos: {} }],
      }),
    ),
  );
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["CREAR_TAREA"]);
});

test("sin documento las acciones de archivo se conservan", () => {
  const r = prepararRespuesta(
    entrada(),
    ai(JSON.stringify({ respuesta: "x", acciones: [{ tipo: "GENERAR_EXCEL", datos: {} }] })),
  );
  assert.deepEqual(r.acciones.map((a) => a.tipo), ["GENERAR_EXCEL"]);
});

test("un documento sin título o sin bloques no es documento", () => {
  for (const roto of [{ titulo: "T" }, { bloques: [] }, { titulo: 1, bloques: [] }, []]) {
    const r = prepararRespuesta(entrada(), ai(JSON.stringify({ respuesta: "x", documento: roto })));
    assert.equal(r.documento, null, `se aceptó un documento roto: ${JSON.stringify(roto)}`);
  }
});

// ---------------------------------------------------------------------------
// Tokens y metadata
// ---------------------------------------------------------------------------

test("los tokens viajan para poder saber cuánto cuesta cada usuario", () => {
  const r = prepararRespuesta(entrada(), ai(OK));
  assert.equal(r.tokens_entrada, 120);
  assert.equal(r.tokens_salida, 45);
});

test("acepta los nombres viejos del usage", () => {
  const r = prepararRespuesta(entrada(), ai(OK, { usage: { prompt_tokens: 7, completion_tokens: 3 } }));
  assert.equal(r.tokens_entrada, 7);
  assert.equal(r.tokens_salida, 3);
});

test("sin usage quedan en cero y no rompen", () => {
  const r = prepararRespuesta(entrada(), ai(OK, { usage: undefined }));
  assert.equal(r.tokens_entrada, 0);
  assert.equal(r.tokens_salida, 0);
});

test("no manda ningún costo en dólares: el precio por token cambia", () => {
  const campos = Object.keys(prepararRespuesta(entrada(), ai(OK))).join(" ").toLowerCase();
  for (const prohibido of ["costo", "dolar", "usd", "precio"]) {
    assert.ok(!campos.includes(prohibido), `apareció "${prohibido}", que envejece mal`);
  }
});

test("la metadata dice de qué camino salió la respuesta", () => {
  const r = prepararRespuesta(entrada(), ai(OK));
  assert.equal(r.metadata.gateway, "ts");
  assert.equal(r.metadata.openai_model, "gpt-5.5");
  assert.equal(r.metadata.openai_status, "completed");
  assert.equal(r.metadata.cantidad_acciones, 0);
});

test("la metadata refleja el archivo de entrada", () => {
  const r = prepararRespuesta(
    entrada({ archivo: { nombre: "t.png", tipo: "image/png", base64: "A" } }),
    ai(OK),
  );
  assert.equal(r.metadata.tiene_archivo, true);
  assert.equal(r.metadata.archivo_entrada_nombre, "t.png");
  assert.equal(r.metadata.imagen_analizada, true);
});

test("un pdf no cuenta como imagen analizada", () => {
  const r = prepararRespuesta(
    entrada({ archivo: { nombre: "a.pdf", tipo: "application/pdf", base64: "A" } }),
    ai(OK),
  );
  assert.equal(r.metadata.imagen_analizada, false);
});

// ---------------------------------------------------------------------------
// La forma que la ruta consume
// ---------------------------------------------------------------------------

test("devuelve exactamente los campos que espera app/api/eos/route.ts", () => {
  const r = prepararRespuesta(entrada(), ai(OK));
  for (const campo of [
    "respuesta",
    "documento",
    "acciones",
    "tipo",
    "accion",
    "archivo_url",
    "archivo_tipo",
    "archivo_nombre",
    "metadata",
    "tokens_entrada",
    "tokens_salida",
  ]) {
    assert.ok(campo in r, `falta ${campo}, que la ruta lee`);
  }
  assert.equal(r.tipo, "texto");
  assert.equal(r.accion, "RESPONDER");
});
