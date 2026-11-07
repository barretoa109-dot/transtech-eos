import assert from "node:assert/strict";
import test from "node:test";

import { generarClave, hashDeClave, PREFIJO_CLAVE } from "./claves.ts";

test("la clave generada empieza con el prefijo y el hash es sha-256 hex", () => {
  const { clave, hash, prefijo } = generarClave();

  assert.ok(clave.startsWith(PREFIJO_CLAVE));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(clave.startsWith(prefijo));
});

test("hashDeClave es determinístico: la misma clave da el mismo hash", () => {
  const { clave, hash } = generarClave();
  assert.equal(hashDeClave(clave), hash);
});

test("dos claves generadas nunca son iguales", () => {
  const a = generarClave();
  const b = generarClave();
  assert.notEqual(a.clave, b.clave);
  assert.notEqual(a.hash, b.hash);
});

test("cambiar un solo carácter de la clave da un hash completamente distinto", () => {
  const { clave, hash } = generarClave();
  const alterada = clave.slice(0, -1) + (clave.at(-1) === "0" ? "1" : "0");
  assert.notEqual(hashDeClave(alterada), hash);
});
