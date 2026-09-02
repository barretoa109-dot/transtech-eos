import assert from "node:assert/strict";
import test from "node:test";
import { calcular } from "../motor.ts";
import { CAPITAL_INMOVILIZADO, DEFINICIONES_INVENTARIO, PRODUCTOS_BAJO_MINIMO } from "./inventario.ts";
import type { Hechos, ProductoHecho } from "../tipos.ts";

const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };

function producto(p: Partial<ProductoHecho> & { id: string }): ProductoHecho {
  return {
    id: p.id,
    nombre: p.nombre ?? "Producto",
    moneda: p.moneda ?? "PYG",
    activo: p.activo ?? true,
    controla_stock: p.controla_stock ?? true,
    stock_actual: p.stock_actual ?? 10,
    stock_minimo: p.stock_minimo ?? 5,
    costo: p.costo ?? null,
    iva: p.iva ?? 10,
  };
}

test("las dos definiciones son instantaneas: el stock es un saldo del momento", () => {
  for (const def of DEFINICIONES_INVENTARIO) assert.equal(def.instantanea, true);
});

test("productos_bajo_minimo usa el mismo criterio que el aviso proactivo del negocio", () => {
  const hechos: Hechos = {
    productos: [
      producto({ id: "p1", stock_actual: 2, stock_minimo: 5 }), // bajo mínimo
      producto({ id: "p2", stock_actual: 5, stock_minimo: 5 }), // igual al mínimo: también cuenta
      producto({ id: "p3", stock_actual: 20, stock_minimo: 5 }), // por encima: no cuenta
      producto({ id: "p4", stock_actual: 0, stock_minimo: 5, controla_stock: false }), // sin control: no cuenta
      producto({ id: "p5", stock_actual: 0, stock_minimo: 5, activo: false }), // dado de baja: no cuenta
    ],
  };
  const [r] = calcular([PRODUCTOS_BAJO_MINIMO], hechos, AGOSTO);
  assert.equal(r.valor, 2);
});

test("sin ningún producto con control de stock, no hay moneda que informar", () => {
  const hechos: Hechos = { productos: [producto({ id: "p1", controla_stock: false })] };
  assert.deepEqual(calcular([PRODUCTOS_BAJO_MINIMO], hechos, AGOSTO), []);
});

test("capital_inmovilizado neta el IVA del costo, igual que el resto de los indicadores de costo", () => {
  // Costo 33 (IVA 10%) por 10 unidades = 330 bruto -> 300 neto.
  const hechos: Hechos = { productos: [producto({ id: "p1", costo: 33, stock_actual: 10, iva: 10 })] };
  const [r] = calcular([CAPITAL_INMOVILIZADO], hechos, AGOSTO);
  assert.equal(r.valor, 300);
  assert.equal(r.confianza.nivel, 1);
});

test("sin costo cargado en ningún producto con stock, dice por qué en vez de mostrar cero", () => {
  const hechos: Hechos = { productos: [producto({ id: "p1", costo: null })] };
  const [r] = calcular([CAPITAL_INMOVILIZADO], hechos, AGOSTO);
  assert.equal(r.valor, null);
  assert.equal(r.estado, "sin_datos");
  assert.equal(r.falta, "Ningún producto con stock tiene costo cargado");
});

test("con costo parcial, se informa el total conocido y se avisa qué falta", () => {
  const hechos: Hechos = {
    productos: [
      producto({ id: "p1", costo: 33, stock_actual: 10 }), // 300 neto
      producto({ id: "p2", costo: null, stock_actual: 5 }),
    ],
  };
  const [r] = calcular([CAPITAL_INMOVILIZADO], hechos, AGOSTO);
  assert.equal(r.valor, 300);
  assert.ok(r.confianza.nivel < 1);
  assert.equal(r.confianza.motivos[0], "1 de 2 productos con stock no tienen costo cargado");
});

test("un costo en cero se trata como no cargado, no como capital cero real", () => {
  const hechos: Hechos = { productos: [producto({ id: "p1", costo: 0, stock_actual: 10 })] };
  const [r] = calcular([CAPITAL_INMOVILIZADO], hechos, AGOSTO);
  assert.equal(r.valor, null);
});
