import assert from "node:assert/strict";
import test from "node:test";

import { conceptosSinCatalogo } from "./conceptos-sin-catalogo.ts";

const item = (descripcion: string, cantidad: number, precio: number, producto_id: string | null = null) => ({
  producto_id,
  descripcion,
  cantidad,
  precio_unitario: precio,
  iva: 0,
});

test("los renglones de distintas compras con el mismo nombre se suman en un solo concepto", () => {
  const compras = [
    { moneda: "PYG", items: [item("Lechón", 1, 320000)] },
    { moneda: "PYG", items: [item("Lechon", 1, 300000), item("lechón ", 2, 300000)] },
  ];

  const [concepto, ...resto] = conceptosSinCatalogo(compras, []);

  assert.equal(resto.length, 0);
  assert.equal(concepto.cantidad, 4);
  // El costo es el de la compra más reciente, la primera de la lista.
  assert.equal(concepto.costo, 320000);
  assert.equal(concepto.nombre, "Lechón");
});

test("lo anulado no se compró", () => {
  const compras = [{ estado: "anulada", moneda: "PYG", items: [item("Vitamina", 1, 64000)] }];

  assert.deepEqual(conceptosSinCatalogo(compras, []), []);
});

test("lo que ya está en el catálogo, o ya tiene producto, no se vuelve a ofrecer", () => {
  const compras = [
    {
      moneda: "PYG",
      items: [item("Balanceado", 5, 68000), item("Vitamina", 1, 64000), item("Flete", 1, 50000, "abc")],
    },
  ];

  const conceptos = conceptosSinCatalogo(compras, ["balanceado"]);

  assert.deepEqual(conceptos.map((c) => c.nombre), ["Vitamina"]);
});
