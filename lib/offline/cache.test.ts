import assert from "node:assert/strict";
import test from "node:test";

import { guardarSnapshot, hace, leerSnapshot } from "./cache.ts";

// Node no tiene `indexedDB`: exactamente el mismo camino que un navegador
// viejo o un modo privado estricto. Sirve para probar que ninguno de los
// dos lanza ni rompe la pantalla que los llama.

test("sin indexedDB, guardarSnapshot no lanza", async () => {
  await assert.doesNotReject(guardarSnapshot("clave", { a: 1 }));
});

test("sin indexedDB, leerSnapshot devuelve null en vez de lanzar", async () => {
  assert.equal(await leerSnapshot("clave"), null);
});

test("hace: minutos, horas y días, en singular y plural", () => {
  const ahora = new Date("2026-11-07T12:00:00Z");

  assert.equal(hace("2026-11-07T11:59:45Z", ahora), "hace un momento");
  assert.equal(hace("2026-11-07T11:59:00Z", ahora), "hace 1 minuto");
  assert.equal(hace("2026-11-07T11:30:00Z", ahora), "hace 30 minutos");
  assert.equal(hace("2026-11-07T11:00:00Z", ahora), "hace 1 hora");
  assert.equal(hace("2026-11-07T06:00:00Z", ahora), "hace 6 horas");
  assert.equal(hace("2026-11-06T12:00:00Z", ahora), "hace 1 día");
  assert.equal(hace("2026-11-04T12:00:00Z", ahora), "hace 3 días");
});

test("hace: una fecha ilegible no lanza (NaN en vez de un número negativo)", () => {
  assert.equal(hace("no es fecha"), "hace un momento");
});
