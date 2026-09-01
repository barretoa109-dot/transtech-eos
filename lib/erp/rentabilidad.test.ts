import assert from "node:assert/strict";
import test from "node:test";
import { calcularRentabilidad } from "./rentabilidad.ts";

test("calcula el margen con el costo congelado de cada venta", () => {
  const [r] = calcularRentabilidad([
    { producto_id: "p1", descripcion: "Camisa", cantidad: 2, venta: 200, costo_unitario: 60, estimado: false, moneda: "PYG" },
  ]);
  assert.equal(r.ventas, 200);
  assert.equal(r.costo, 120);
  assert.equal(r.margen, 80);
  assert.equal(r.margen_porcentaje, 40);
});

test("no inventa margen para líneas sin costo", () => {
  const [r] = calcularRentabilidad([
    { producto_id: null, descripcion: "Servicio", cantidad: 1, venta: 100, costo_unitario: null, estimado: false, moneda: "PYG" },
  ]);
  assert.equal(r.ventas, 0);
  assert.equal(r.ventas_sin_costo, 1);
  assert.equal(r.margen_porcentaje, null);
});

test("nunca mezcla monedas y marca los datos históricos estimados", () => {
  const resumen = calcularRentabilidad([
    { producto_id: "p1", descripcion: "A", cantidad: 1, venta: 100, costo_unitario: 50, estimado: true, moneda: "PYG" },
    { producto_id: "p2", descripcion: "B", cantidad: 1, venta: 20, costo_unitario: 10, estimado: false, moneda: "USD" },
  ]);
  assert.equal(resumen.length, 2);
  assert.equal(resumen.find((r) => r.moneda === "PYG")?.contiene_estimaciones, true);
  assert.equal(resumen.find((r) => r.moneda === "USD")?.margen, 10);
});
