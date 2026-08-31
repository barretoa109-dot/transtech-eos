import assert from "node:assert/strict";
import test from "node:test";

import { numeroProducto, numeroProductoOpcional } from "./entrada-producto.ts";

test("los números inválidos no se convierten silenciosamente en cero", () => {
  for (const valor of ["", "texto", Number.NaN, Infinity, -Infinity, null, undefined, true]) {
    assert.deepEqual(numeroProducto(valor), { ok: false, motivo: "numero-invalido" });
  }
});

test("rechaza costos, precios y mínimos negativos", () => {
  assert.deepEqual(numeroProducto(-0.01), { ok: false, motivo: "numero-negativo" });
});

test("acepta cero y números decimales finitos", () => {
  assert.deepEqual(numeroProducto(0), { ok: true, valor: 0 });
  assert.deepEqual(numeroProducto("1250.5"), { ok: true, valor: 1250.5 });
});

test("sólo el campo opcional admite null o ausencia", () => {
  assert.deepEqual(numeroProductoOpcional(null), { ok: true, valor: null });
  assert.deepEqual(numeroProductoOpcional(undefined), { ok: true, valor: null });
  assert.deepEqual(numeroProductoOpcional(""), { ok: false, motivo: "numero-invalido" });
});
