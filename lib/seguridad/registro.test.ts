import assert from "node:assert/strict";
import test from "node:test";

import { paraRegistro, resumenDeRespuesta } from "./registro.ts";

// ============================================================
// Los tres casos reales que aparecieron al buscarlos
// ============================================================

test("la respuesta cruda de n8n no llega al log", () => {
  // Lo que puede volver adentro del cuerpo de un error: el mensaje que
  // escribió la persona.
  const cuerpo = "El usuario preguntó: ¿me alcanza para pagarle a mi mamá el remedio?";

  assert.equal(paraRegistro(cuerpo), `«${cuerpo.length} caracteres, no se registran»`);
});

test("pero si el cuerpo es un JSON de error, sus campos útiles sí pasan", () => {
  const limpio = paraRegistro('{"code":"ETIMEDOUT","status":504,"mensaje":"lo que dijo el usuario"}');

  assert.deepEqual(limpio, { code: "ETIMEDOUT", status: 504, __omitidos: 1 });
});

test("la fila de un efecto del worker pasa sin su payload", () => {
  const efecto = {
    command_id: "abc-123",
    effect_id: "def-456",
    status: "invalid",
    payload: { monto: 250000, descripcion: "lo que pidió el usuario" },
  };

  assert.deepEqual(paraRegistro(efecto), {
    command_id: "abc-123",
    effect_id: "def-456",
    status: "invalid",
    __omitidos: 1,
  });
});

test("el objeto de autorización pasa sin su snapshot", () => {
  const autorizacion = {
    ok: false,
    execute: false,
    command_id: "abc",
    payload_snapshot: { mensaje: "vendé 3 kilos a doña Rosa" },
  };

  const limpio = paraRegistro(autorizacion) as Record<string, unknown>;

  assert.equal(limpio.ok, false);
  assert.equal(limpio.command_id, "abc");
  assert.equal(limpio.payload_snapshot, undefined);
  assert.equal(limpio.__omitidos, 1);
});

// ============================================================
// Quién es la persona, tampoco
// ============================================================

test("el correo, el teléfono y el nombre no se registran", () => {
  const limpio = paraRegistro({
    usuario_id: "uuid-que-sí-sirve",
    email: "alguien@ejemplo.com",
    telefono: "0981 000 000",
    nombre: "Rosa",
    ruc: "80012345-6",
  }) as Record<string, unknown>;

  assert.deepEqual(Object.keys(limpio).sort(), ["__omitidos", "usuario_id"]);
  assert.equal(limpio.__omitidos, 4);
});

test("las credenciales tampoco, ni con nombre disfrazado", () => {
  const limpio = paraRegistro({
    ok: true,
    access_token: "eyJhbGciOi...",
    refresh_token: "otro",
    SUPABASE_API_KEY: "secreta",
    authorization: "Bearer x",
  }) as Record<string, unknown>;

  assert.deepEqual(Object.keys(limpio).sort(), ["__omitidos", "ok"]);
});

// ============================================================
// Lo que sí tiene que pasar, porque si no el log no sirve
// ============================================================

test("los códigos, los estados y los conteos pasan enteros", () => {
  assert.deepEqual(paraRegistro({ status: 503, code: "PGRST116", filas: 0, ok: false }), {
    status: 503,
    code: "PGRST116",
    filas: 0,
    ok: false,
  });
});

test("un Error se registra por su nombre y su mensaje", () => {
  assert.equal(paraRegistro(new TypeError("algo salió mal")), "TypeError: algo salió mal");
});

test("un objeto anidado se anuncia pero no se abre", () => {
  assert.deepEqual(paraRegistro({ ok: false, metadata: { lo: "que", sea: 1 } }), {
    ok: false,
    metadata: "«objeto»",
  });
});

test("una lista dice cuántos elementos tenía y nada más", () => {
  assert.equal(paraRegistro([1, 2, 3]), "«lista de 3»");
  assert.deepEqual(paraRegistro({ ok: true, filas: [1, 2] }), { ok: true, filas: "«lista de 2»" });
});

test("los textos largos con nombre inocuo se recortan", () => {
  const limpio = paraRegistro({ code: "x".repeat(400) }) as Record<string, string>;

  assert.ok(limpio.code.length < 130);
  assert.ok(limpio.code.endsWith("…"));
});

test("nunca lanza, ni con lo más raro", () => {
  const circular: Record<string, unknown> = { ok: true };
  circular.yo = circular;

  assert.doesNotThrow(() => paraRegistro(circular));
  assert.doesNotThrow(() => paraRegistro(Symbol("x")));
  assert.doesNotThrow(() => paraRegistro(undefined));
  assert.doesNotThrow(() => paraRegistro(() => {}));
});

// ============================================================
// El resumen de una respuesta fallida
// ============================================================

test("de una respuesta fallida se dice el código y el tamaño, no el cuerpo", () => {
  const cuerpo = "la conversación entera de alguien, mil caracteres de largo";
  const resumen = resumenDeRespuesta(502, cuerpo);

  assert.equal(resumen.status, 502);
  assert.equal(resumen.largo, cuerpo.length);
  assert.ok(!JSON.stringify(resumen).includes("conversación"));
});

test("y si el cuerpo era un JSON de error, se conserva lo que ayuda", () => {
  const resumen = resumenDeRespuesta(504, '{"code":"ETIMEDOUT","workflow":"gateway"}');

  assert.deepEqual(resumen.detalle, { code: "ETIMEDOUT", workflow: "gateway" });
});
