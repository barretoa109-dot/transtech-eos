import test from "node:test";
import assert from "node:assert/strict";

import {
  EntradaInvalida,
  TOPE_CONTEXTO,
  TURNOS_DE_HISTORIAL,
  categoriaDe,
  prepararEntrada,
} from "./entrada.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

function payload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "hola",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Lo que no puede pasar
// ---------------------------------------------------------------------------

test("sin request_id válido no hay idempotencia y se rechaza", () => {
  assert.throws(() => prepararEntrada(payload({ request_id: "no-es-uuid" })), EntradaInvalida);
  assert.throws(() => prepararEntrada(payload({ request_id: "" })), EntradaInvalida);
});

test("sin usuario válido se rechaza", () => {
  assert.throws(() => prepararEntrada(payload({ usuario_id: "x" })), EntradaInvalida);
});

test("sin conversación válida se rechaza", () => {
  assert.throws(() => prepararEntrada(payload({ conversacion_id: undefined })), EntradaInvalida);
});

test("sin mensaje no hay nada que responder", () => {
  assert.throws(() => prepararEntrada(payload({ mensaje: "   " })), EntradaInvalida);
});

// ---------------------------------------------------------------------------
// Valores por defecto, iguales a los de n8n
// ---------------------------------------------------------------------------

test("los defectos son los mismos que usa n8n", () => {
  const e = prepararEntrada(payload());
  assert.equal(e.nombre, "Usuario");
  assert.equal(e.plan, "free");
  assert.equal(e.origen, "eos-web");
  assert.equal(e.contexto_negocio, "");
  assert.deepEqual(e.historial, []);
  assert.equal(e.archivo, null);
  assert.equal(e.tiene_archivo, false);
});

test("un nombre en blanco cae al defecto, no queda vacío", () => {
  assert.equal(prepararEntrada(payload({ nombre: "   " })).nombre, "Usuario");
});

test("acepta los nombres alternativos del campo, igual que n8n", () => {
  assert.equal(prepararEntrada(payload({ mensaje: undefined, message: "hola" })).mensaje, "hola");
  assert.equal(
    prepararEntrada(payload({ usuario_id: undefined, user_id: UUID_B })).usuario_id,
    UUID_B,
  );
});

// ---------------------------------------------------------------------------
// Los topes
// ---------------------------------------------------------------------------

test("el contexto del negocio se recorta: entra en cada llamada a OpenAI", () => {
  const largo = "x".repeat(TOPE_CONTEXTO + 500);
  assert.equal(prepararEntrada(payload({ contexto_negocio: largo })).contexto_negocio.length, TOPE_CONTEXTO);
});

test("el historial se queda con los últimos turnos, no los primeros", () => {
  const historial = Array.from({ length: 25 }, (_, i) => ({ rol: "usuario", texto: `m${i}` }));
  const e = prepararEntrada(payload({ historial }));
  assert.equal(e.historial.length, TURNOS_DE_HISTORIAL);
  assert.equal(e.historial[0].texto, "m15", "se guardaron los turnos viejos en vez de los recientes");
  assert.equal(e.historial.at(-1)?.texto, "m24");
});

test("un historial que no es lista se ignora sin romper", () => {
  assert.deepEqual(prepararEntrada(payload({ historial: "hola" })).historial, []);
});

// ---------------------------------------------------------------------------
// Clasificar el archivo
// ---------------------------------------------------------------------------

test("un docx no se confunde con una planilla", () => {
  // Los dos MIME contienen "officedocument": el orden de las preguntas es lo
  // único que los separa.
  assert.equal(
    categoriaDe("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "word",
  );
  assert.equal(
    categoriaDe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "excel",
  );
});

test("clasifica el resto de los tipos como n8n", () => {
  assert.equal(categoriaDe("image/png"), "imagen");
  assert.equal(categoriaDe("application/pdf"), "pdf");
  assert.equal(categoriaDe("text/csv"), "csv");
  assert.equal(categoriaDe("text/plain"), "texto");
  assert.equal(categoriaDe("application/zip"), "otro");
  assert.equal(categoriaDe(""), "");
});

test("un csv es csv y no texto, aunque empiece con text/", () => {
  assert.equal(categoriaDe("text/csv"), "csv");
  assert.notEqual(categoriaDe("text/csv"), "texto");
});

// ---------------------------------------------------------------------------
// La imagen
// ---------------------------------------------------------------------------

test("una imagen sin data url se la arma con su tipo", () => {
  const e = prepararEntrada(
    payload({ archivo: { nombre: "foto.png", tipo: "image/png", base64: "AAAA" } }),
  );
  assert.equal(e.imagen_data_url, "data:image/png;base64,AAAA");
  assert.equal(e.archivo_categoria, "imagen");
});

test("una imagen que ya viene como data url no se envuelve dos veces", () => {
  const url = "data:image/jpeg;base64,BBBB";
  const e = prepararEntrada(payload({ archivo: { nombre: "f.jpg", tipo: "image/jpeg", base64: url } }));
  assert.equal(e.imagen_data_url, url);
  assert.ok(!e.imagen_data_url.includes("base64,data:"), "se envolvió una data url dentro de otra");
});

test("un pdf no genera data url de imagen", () => {
  const e = prepararEntrada(
    payload({ archivo: { nombre: "a.pdf", tipo: "application/pdf", base64: "AAAA" } }),
  );
  assert.equal(e.imagen_data_url, "");
  assert.equal(e.archivo_categoria, "pdf");
  assert.equal(e.tiene_archivo, true);
});

test("un adjunto incompleto no es adjunto", () => {
  for (const roto of [
    { nombre: "a.png", tipo: "image/png" },
    { nombre: "a.png", base64: "AAA" },
    { tipo: "image/png", base64: "AAA" },
  ]) {
    const e = prepararEntrada(payload({ archivo: roto }));
    assert.equal(e.archivo, null, "se aceptó un adjunto sin las tres partes");
    assert.equal(e.tiene_archivo, false);
  }
});

test("un archivo que no es objeto se ignora", () => {
  assert.equal(prepararEntrada(payload({ archivo: "foto.png" })).archivo, null);
  assert.equal(prepararEntrada(payload({ archivo: ["x"] })).archivo, null);
});

test("el tamaño que no es número queda en cero, no en NaN", () => {
  const e = prepararEntrada(
    payload({ archivo: { nombre: "a.png", tipo: "image/png", base64: "A", tamanio: "grande" } }),
  );
  assert.equal(e.archivo_tamanio, 0);
});
