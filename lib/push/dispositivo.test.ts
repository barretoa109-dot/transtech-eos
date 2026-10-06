import assert from "node:assert/strict";
import { test } from "node:test";

import { leerDispositivoPush } from "./dispositivo.ts";

const TOKEN = "a".repeat(64);

test("acepta iOS y Android con un token válido", () => {
  assert.deepEqual(leerDispositivoPush({ plataforma: "ios", token: TOKEN }), {
    plataforma: "ios",
    token: TOKEN,
  });
  assert.deepEqual(leerDispositivoPush({ plataforma: "android", token: TOKEN }), {
    plataforma: "android",
    token: TOKEN,
  });
});

test("recorta espacios del token", () => {
  assert.equal(leerDispositivoPush({ plataforma: "ios", token: `  ${TOKEN}  ` })?.token, TOKEN);
});

test("rechaza plataformas que no son ios ni android", () => {
  assert.equal(leerDispositivoPush({ plataforma: "web", token: TOKEN }), null);
  assert.equal(leerDispositivoPush({ token: TOKEN }), null);
});

test("rechaza tokens cortos, largos o que no son texto", () => {
  assert.equal(leerDispositivoPush({ plataforma: "ios", token: "corto" }), null);
  assert.equal(leerDispositivoPush({ plataforma: "ios", token: "a".repeat(4097) }), null);
  assert.equal(leerDispositivoPush({ plataforma: "ios", token: 12345678901234567 }), null);
});

test("rechaza cuerpos que no son objetos", () => {
  assert.equal(leerDispositivoPush(null), null);
  assert.equal(leerDispositivoPush("ios"), null);
});
