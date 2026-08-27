import assert from "node:assert/strict";
import { test } from "node:test";

import { tasaValida } from "./impuestos.ts";
import { normalizarItemsErp } from "./entrada.ts";

test("rechaza NaN e infinitos antes de llamar al RPC", () => {
  for (const precio of ["NaN", Number.NaN, Infinity, -Infinity]) {
    assert.deepEqual(
      normalizarItemsErp([{ cantidad: 1, precio_unitario: precio }], tasaValida),
      { ok: false, motivo: "precio-invalido" },
    );
  }
});

test("rechaza precios negativos en vez de convertirlos en movimientos negativos", () => {
  assert.deepEqual(
    normalizarItemsErp([{ cantidad: 2, precio_unitario: -1 }], tasaValida),
    { ok: false, motivo: "precio-invalido" },
  );
});

test("rechaza la operación entera si un solo ítem es inválido", () => {
  const resultado = normalizarItemsErp(
    [
      { producto_id: "uno", cantidad: 2, precio_unitario: 10_000 },
      { producto_id: "dos", cantidad: 1, precio_unitario: -10 },
    ],
    tasaValida,
  );

  assert.deepEqual(resultado, { ok: false, motivo: "precio-invalido" });
});

test("mantiene null para usar el precio del producto y acepta cero", () => {
  const resultado = normalizarItemsErp(
    [
      { producto_id: "uno", cantidad: 2 },
      { descripcion: "Bonificación", cantidad: 1, precio_unitario: 0, iva: 0 },
    ],
    tasaValida,
  );

  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.items[0].precio_unitario, null);
  assert.equal(resultado.items[1].precio_unitario, 0);
});

test("rechaza cantidades inválidas sin devolver ítems parcialmente procesados", () => {
  for (const cantidad of [0, -1, "NaN", Infinity]) {
    assert.deepEqual(
      normalizarItemsErp([{ cantidad, precio_unitario: 100 }], tasaValida),
      { ok: false, motivo: "cantidad-invalida" },
    );
  }
});

test("rechaza el payload entero si contiene un elemento que no es un objeto", () => {
  assert.deepEqual(
    normalizarItemsErp([{ cantidad: 1, precio_unitario: 100 }, "basura"], tasaValida),
    { ok: false, motivo: "item-invalido" },
  );
});

test("rechaza el payload entero cuando supera el máximo de ítems", () => {
  const items = Array.from({ length: 3 }, () => ({ cantidad: 1, precio_unitario: 100 }));
  assert.deepEqual(normalizarItemsErp(items, tasaValida, 2), {
    ok: false,
    motivo: "demasiados-items",
  });
});
