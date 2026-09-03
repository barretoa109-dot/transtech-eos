import assert from "node:assert/strict";
import test from "node:test";
import {
  costoDeLoVendido,
  diasDeInventario,
  inventarioPromedio,
  rotacion,
  stockQuieto,
  valorInventario,
  type MovimientoKardex,
  type ProductoStock,
} from "./kardex.ts";

function p(x: Partial<ProductoStock> & { id: string }): ProductoStock {
  return {
    id: x.id,
    nombre: x.nombre ?? x.id,
    moneda: x.moneda ?? "PYG",
    stock_actual: x.stock_actual ?? 10,
    costo_promedio: x.costo_promedio === undefined ? 1000 : x.costo_promedio,
    activo: x.activo ?? true,
    controla_stock: x.controla_stock ?? true,
  };
}

function m(x: Partial<MovimientoKardex> & { fecha: string; tipo: MovimientoKardex["tipo"] }): MovimientoKardex {
  return {
    fecha: x.fecha,
    tipo: x.tipo,
    cantidad: x.cantidad ?? 1,
    costo_unitario: x.costo_unitario === undefined ? 1000 : x.costo_unitario,
    valor_resultante: x.valor_resultante === undefined ? 10000 : x.valor_resultante,
    producto_id: x.producto_id ?? "p1",
    moneda: x.moneda ?? "PYG",
  };
}

test("el valor del inventario suma stock por costo promedio, y avisa cuántos no tienen costo", () => {
  const [v] = valorInventario([
    p({ id: "a", stock_actual: 10, costo_promedio: 1000 }),
    p({ id: "b", stock_actual: 5, costo_promedio: 2000 }),
    p({ id: "c", stock_actual: 99, costo_promedio: null }),
  ]);
  assert.equal(v.valor, 20_000);
  assert.equal(v.productos, 3);
  assert.equal(v.sin_costo, 1);
});

test("lo inactivo y lo que no controla stock no se valoriza", () => {
  const v = valorInventario([
    p({ id: "a", activo: false }),
    p({ id: "b", controla_stock: false }),
  ]);
  assert.deepEqual(v, []);
});

test("nunca se mezclan monedas", () => {
  const v = valorInventario([
    p({ id: "a", moneda: "PYG", stock_actual: 10, costo_promedio: 1000 }),
    p({ id: "b", moneda: "USD", stock_actual: 2, costo_promedio: 50 }),
  ]);
  assert.equal(v.find((x) => x.moneda === "PYG")?.valor, 10_000);
  assert.equal(v.find((x) => x.moneda === "USD")?.valor, 100);
});

test("el costo de lo vendido usa el COSTO, no el precio, y solo las salidas", () => {
  const movs = [
    m({ fecha: "2026-09-05", tipo: "salida", cantidad: 3, costo_unitario: 1000 }),
    m({ fecha: "2026-09-06", tipo: "entrada", cantidad: 10, costo_unitario: 1000 }),
  ];
  assert.equal(costoDeLoVendido(movs, "PYG", "2026-09-01", "2026-09-30"), 3000);
});

test("un ajuste por rotura no cuenta como costo de ventas", () => {
  // Si contara, romper mercadería parecería vender más.
  const movs = [m({ fecha: "2026-09-05", tipo: "ajuste", cantidad: 50, costo_unitario: 1000 })];
  assert.equal(costoDeLoVendido(movs, "PYG", "2026-09-01", "2026-09-30"), null);
});

test("sin salidas con costo conocido, el costo de lo vendido es null y no cero", () => {
  const movs = [m({ fecha: "2026-09-05", tipo: "salida", cantidad: 3, costo_unitario: null })];
  assert.equal(costoDeLoVendido(movs, "PYG", "2026-09-01", "2026-09-30"), null);
  assert.notEqual(costoDeLoVendido(movs, "PYG", "2026-09-01", "2026-09-30"), 0);
});

test("el inventario promedio necesita un valor ANTERIOR al período; sin él es null", () => {
  const soloDentro = [m({ fecha: "2026-09-10", tipo: "entrada", valor_resultante: 50_000 })];
  // Sin movimiento previo no se sabe con qué stock arrancó: cero diría que
  // el negocio empezó el período sin nada.
  assert.equal(inventarioPromedio(soloDentro, "PYG", "2026-09-01", "2026-09-30", 50_000), null);
});

test("con extremos conocidos, el promedio es la media de inicio y fin", () => {
  const movs = [
    m({ fecha: "2026-08-20", tipo: "entrada", valor_resultante: 100_000 }),
    m({ fecha: "2026-09-10", tipo: "salida", valor_resultante: 60_000 }),
  ];
  assert.equal(inventarioPromedio(movs, "PYG", "2026-09-01", "2026-09-30", 60_000), 80_000);
});

test("sin movimientos dentro del período, el final es el valor de hoy", () => {
  const movs = [m({ fecha: "2026-08-20", tipo: "entrada", valor_resultante: 100_000 })];
  assert.equal(inventarioPromedio(movs, "PYG", "2026-09-01", "2026-09-30", 40_000), 70_000);
});

test("la rotación es costo sobre inventario promedio", () => {
  assert.equal(rotacion(240_000, 80_000), 3);
});

test("con inventario promedio cero la rotación es null: no se divide por cero", () => {
  assert.equal(rotacion(240_000, 0), null);
  assert.notEqual(rotacion(240_000, 0), Infinity);
});

test("sin costo de lo vendido no hay rotación", () => {
  assert.equal(rotacion(null, 80_000), null);
});

test("los días de inventario salen del largo REAL del período, no de 365", () => {
  // Rotación 3 en 30 días -> el stock dura 10 días.
  assert.equal(diasDeInventario(3, 30), 10);
  // Con la cuenta anualizada daría 121,7, que nadie pidió.
  assert.notEqual(diasDeInventario(3, 30), 121.7);
});

test("sin rotación no hay días de inventario", () => {
  assert.equal(diasDeInventario(null, 30), null);
  assert.equal(diasDeInventario(0, 30), null);
});

test("el stock quieto es lo que tiene existencia y no salió en el período", () => {
  const productos = [
    p({ id: "vendido", stock_actual: 5 }),
    p({ id: "quieto", stock_actual: 8, costo_promedio: 2000 }),
    p({ id: "agotado", stock_actual: 0 }),
  ];
  const movs = [m({ fecha: "2026-09-05", tipo: "salida", producto_id: "vendido" })];

  const quietos = stockQuieto(productos, movs, "2026-09-01", "2026-09-30", "PYG");
  assert.deepEqual(quietos.map((q) => q.id), ["quieto"]);
  assert.equal(quietos[0].valor, 16_000);
});

test("un producto agotado no es stock quieto: no se movió porque no había", () => {
  const quietos = stockQuieto([p({ id: "agotado", stock_actual: 0 })], [], "2026-09-01", "2026-09-30", "PYG");
  assert.deepEqual(quietos, []);
});

test("lo quieto sale de mayor a menor valor: ahí está la plata parada", () => {
  const productos = [
    p({ id: "barato", stock_actual: 1, costo_promedio: 100 }),
    p({ id: "caro", stock_actual: 10, costo_promedio: 5000 }),
  ];
  const quietos = stockQuieto(productos, [], "2026-09-01", "2026-09-30", "PYG");
  assert.deepEqual(quietos.map((q) => q.id), ["caro", "barato"]);
});

test("un producto quieto sin costo aparece igual, con valor null", () => {
  const quietos = stockQuieto(
    [p({ id: "sin", stock_actual: 3, costo_promedio: null })],
    [],
    "2026-09-01",
    "2026-09-30",
    "PYG",
  );
  assert.equal(quietos[0].valor, null);
  assert.notEqual(quietos[0].valor, 0);
});
