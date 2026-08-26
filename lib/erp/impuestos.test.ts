import assert from "node:assert/strict";
import { test } from "node:test";

import { calcularVenta, ivaIncluido, tasaValida, type LineaVenta } from "./impuestos.ts";

function linea(precio: number, cantidad = 1, iva: 0 | 5 | 10 = 10): LineaVenta {
  return { descripcion: "Producto", cantidad, precio_unitario: precio, iva };
}

test("el IVA se saca de adentro del precio, no se suma encima", () => {
  // 55.000 con IVA 10% son 50.000 + 5.000, NO 55.000 + 5.500. Sumarlo encima
  // es facturar un 10% de más.
  const venta = calcularVenta([linea(55_000)]);

  assert.equal(venta.total, 55_000);
  assert.equal(venta.iva_total, 5_000);
  assert.equal(venta.subtotal, 50_000);
});

test("la tasa del 5% divide por 21", () => {
  const venta = calcularVenta([linea(21_000, 1, 5)]);

  assert.equal(venta.iva_total, 1_000);
  assert.equal(venta.subtotal, 20_000);
});

test("una línea exenta no aporta impuesto y va en su propia casilla", () => {
  const venta = calcularVenta([linea(30_000, 1, 0)]);

  assert.equal(venta.iva_total, 0);
  assert.equal(venta.exentas, 30_000);
  assert.equal(venta.subtotal, 30_000);
});

test("el total es la suma de las líneas redondeadas, no el redondeo de la suma", () => {
  // Es lo que hace que la factura cierre cuando alguien la suma a mano, y
  // alguien siempre la suma a mano.
  const venta = calcularVenta([linea(3_333.4, 3), linea(1_666.6, 3)]);

  const sumaDeLineas = venta.lineas.reduce((t, l) => t + l.total, 0);
  assert.equal(venta.total, sumaDeLineas);
  assert.ok(Number.isInteger(venta.total));
});

test("el desglose por tasa solo trae las tasas que se usaron", () => {
  const venta = calcularVenta([linea(11_000), linea(21_000, 1, 5)]);

  assert.deepEqual(
    venta.por_tasa.map((t) => t.tasa),
    [10, 5],
  );
  assert.equal(venta.por_tasa[0].iva, 1_000);
  assert.equal(venta.por_tasa[1].iva, 1_000);
});

test("las cantidades multiplican antes de sacar el impuesto", () => {
  const venta = calcularVenta([linea(11_000, 3)]);

  assert.equal(venta.total, 33_000);
  assert.equal(venta.iva_total, 3_000);
});

test("una tasa inventada cae en la general y no rompe el cálculo", () => {
  assert.equal(tasaValida(7), 10);
  assert.equal(tasaValida("5"), 5);
  // Una tasa ausente NO es exención: facturar como exenta algo gravado es un
  // problema con la SET, no un detalle de redondeo.
  assert.equal(tasaValida(null), 10);
  assert.equal(tasaValida(undefined), 10);
  assert.equal(tasaValida(""), 10);
  assert.equal(tasaValida(0), 0);
});

test("el impuesto de un precio suelto se puede pedir sin armar una venta", () => {
  assert.equal(ivaIncluido(1_100, 10), 100);
  assert.equal(ivaIncluido(1_000, 0), 0);
});
