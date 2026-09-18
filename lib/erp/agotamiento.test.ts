import assert from "node:assert/strict";
import test from "node:test";

import {
  proyectarAgotamiento,
  type ProductoAgotable,
  type SalidaDeStock,
} from "./agotamiento.ts";

const HOY = "2026-09-18";

function producto(parcial: Partial<ProductoAgotable> & { id: string }): ProductoAgotable {
  return {
    nombre: `Producto ${parcial.id}`,
    stock_actual: 10,
    stock_minimo: 2,
    controla_stock: true,
    activo: true,
    ...parcial,
  };
}

/** `n` salidas de `cada` unidades, repartidas en los últimos días. */
function salidas(id: string, n: number, cada: number, desdeAtras = 1): SalidaDeStock[] {
  return Array.from({ length: n }, (_, i) => ({
    producto_id: id,
    fecha: `2026-09-${String(18 - desdeAtras - i).padStart(2, "0")}`,
    cantidad: cada,
  }));
}

test("el que se vende rápido y todavía no está bajo el mínimo se avisa antes", () => {
  // 30 unidades en el mes = 1 por día; con 10 en stock, alcanza 10 días.
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [producto({ id: "a", stock_actual: 10, stock_minimo: 2 })],
    salidas: salidas("a", 6, 5),
  });

  assert.equal(r.length, 1);
  assert.equal(r[0].dias_restantes, 10);
  assert.equal(r[0].ritmo_diario, 1);
});

test("el que tiene poco stock pero no se vende NO se acaba: se calla", () => {
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [producto({ id: "a", stock_actual: 4, stock_minimo: 1 })],
    salidas: [],
  });
  assert.deepEqual(r, []);
});

test("con menos de tres movimientos no hay ritmo que afirmar", () => {
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [producto({ id: "a", stock_actual: 5, stock_minimo: 1 })],
    // Dos ventas grandes: matemáticamente daría pocos días, pero es un punto, no un ritmo.
    salidas: salidas("a", 2, 30),
  });
  assert.deepEqual(r, []);
});

test("lo que ya está en o bajo el mínimo lo cubre inventario_bajo, no esto", () => {
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [
      producto({ id: "en-minimo", stock_actual: 3, stock_minimo: 3 }),
      producto({ id: "bajo", stock_actual: 1, stock_minimo: 3 }),
      producto({ id: "agotado", stock_actual: 0, stock_minimo: 0 }),
    ],
    salidas: [...salidas("en-minimo", 5, 5), ...salidas("bajo", 5, 5), ...salidas("agotado", 5, 5)],
  });
  assert.deepEqual(r, []);
});

test("un producto que dura más que el horizonte no se avisa", () => {
  // 1 por día con 40 en stock: 40 días.
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [producto({ id: "a", stock_actual: 40, stock_minimo: 2 })],
    salidas: salidas("a", 6, 5),
  });
  assert.deepEqual(r, []);
});

test("las salidas de hace más de un mes no cuentan para el ritmo", () => {
  const viejas: SalidaDeStock[] = Array.from({ length: 6 }, (_, i) => ({
    producto_id: "a",
    fecha: `2026-07-${String(10 + i).padStart(2, "0")}`,
    cantidad: 50,
  }));

  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [producto({ id: "a", stock_actual: 5, stock_minimo: 1 })],
    salidas: viejas,
  });
  assert.deepEqual(r, []);
});

test("un servicio o un producto dado de baja no entra", () => {
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [
      producto({ id: "servicio", controla_stock: false }),
      producto({ id: "baja", activo: false }),
    ],
    salidas: [...salidas("servicio", 6, 5), ...salidas("baja", 6, 5)],
  });
  assert.deepEqual(r, []);
});

test("lo más urgente va primero y el orden es estable", () => {
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [
      producto({ id: "lento", stock_actual: 12, stock_minimo: 1 }),
      producto({ id: "rapido", stock_actual: 6, stock_minimo: 1 }),
    ],
    salidas: [...salidas("lento", 6, 5), ...salidas("rapido", 6, 5)],
  });
  assert.deepEqual(
    r.map((x) => x.id),
    ["rapido", "lento"],
  );
});

test("cantidades raras (cero, negativas, texto) no rompen ni cuentan", () => {
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [producto({ id: "a", stock_actual: 5, stock_minimo: 1 })],
    salidas: [
      { producto_id: "a", fecha: "2026-09-10", cantidad: 0 },
      { producto_id: "a", fecha: "2026-09-11", cantidad: -4 },
      { producto_id: "a", fecha: "", cantidad: 3 },
      { producto_id: "a", fecha: "2026-09-12", cantidad: Number.NaN },
    ],
  });
  assert.deepEqual(r, []);
});

test("acepta fechas con hora, como las guarda el kardex", () => {
  const r = proyectarAgotamiento({
    hoy: HOY,
    productos: [producto({ id: "a", stock_actual: 6, stock_minimo: 1 })],
    salidas: Array.from({ length: 6 }, (_, i) => ({
      producto_id: "a",
      fecha: `2026-09-${String(10 + i).padStart(2, "0")}T14:30:00+00:00`,
      cantidad: 5,
    })),
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].dias_restantes, 6);
});
