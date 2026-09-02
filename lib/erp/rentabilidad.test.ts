import assert from "node:assert/strict";
import test from "node:test";
import { calcularRentabilidad } from "./rentabilidad.ts";

test("calcula el margen con el costo congelado de cada venta, neto de IVA", () => {
  const [r] = calcularRentabilidad([
    { producto_id: "p1", descripcion: "Camisa", cantidad: 1, venta: 110, iva: 10, costo_unitario: 33, estimado: false, moneda: "PYG" },
  ]);
  // 110 con IVA 10% → 100 neto. 33 con IVA 10% → 30 neto.
  assert.equal(r.ventas, 100);
  assert.equal(r.costo, 30);
  assert.equal(r.margen, 70);
  assert.equal(r.margen_porcentaje, 70);
});

test("el margen en guaraníes es neto, no bruto: esta es la cuenta que ya estuvo mal", () => {
  const [r] = calcularRentabilidad([
    { producto_id: "p1", descripcion: "Camisa", cantidad: 1, venta: 110, iva: 10, costo_unitario: 33, estimado: false, moneda: "PYG" },
  ]);
  // La cuenta bruta —110 de ventas, 33 de costo, 77 de margen— es la que
  // mostraba esta pantalla mientras `lib/erp/indicadores.ts` ya mostraba la
  // neta: dos cifras distintas de la misma plata en la misma vista.
  // (El porcentaje da igual en los dos casos cuando la tasa es la misma para
  // venta y costo, porque el IVA escala las dos puntas por igual; lo que
  // cambia es la cifra en guaraníes que la clienta lee.)
  assert.notEqual(r.ventas, 110);
  assert.notEqual(r.costo, 33);
  assert.notEqual(r.margen, 77);
});

test("no inventa margen para líneas sin costo", () => {
  const [r] = calcularRentabilidad([
    { producto_id: null, descripcion: "Servicio", cantidad: 1, venta: 110, iva: 10, costo_unitario: null, estimado: false, moneda: "PYG" },
  ]);
  assert.equal(r.ventas, 0);
  assert.equal(r.ventas_sin_costo, 1);
  assert.equal(r.margen_porcentaje, null);
});

test("nunca mezcla monedas y marca los datos históricos estimados", () => {
  const resumen = calcularRentabilidad([
    { producto_id: "p1", descripcion: "A", cantidad: 1, venta: 110, iva: 10, costo_unitario: 55, estimado: true, moneda: "PYG" },
    { producto_id: "p2", descripcion: "B", cantidad: 1, venta: 22, iva: 10, costo_unitario: 11, estimado: false, moneda: "USD" },
  ]);
  assert.equal(resumen.length, 2);
  assert.equal(resumen.find((r) => r.moneda === "PYG")?.contiene_estimaciones, true);
  // 22 con IVA 10% → 20 neto; 11 con IVA 10% → 10 neto; margen 10.
  assert.equal(resumen.find((r) => r.moneda === "USD")?.margen, 10);
});

test("agrupa por producto con el mismo criterio neto", () => {
  const resumen = calcularRentabilidad([
    { producto_id: "p1", descripcion: "Camisa", cantidad: 1, venta: 110, iva: 10, costo_unitario: 33, estimado: false, moneda: "PYG" },
    { producto_id: "p1", descripcion: "Camisa", cantidad: 1, venta: 110, iva: 10, costo_unitario: 33, estimado: false, moneda: "PYG" },
  ]);
  const [r] = resumen;
  assert.equal(r.productos.length, 1);
  assert.equal(r.productos[0].ventas, 200);
  assert.equal(r.productos[0].margen, 140);
});
