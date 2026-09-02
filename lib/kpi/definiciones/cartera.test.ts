import assert from "node:assert/strict";
import test from "node:test";
import { calcular } from "../motor.ts";
import { COBROS_DEMORADOS, CUENTAS_POR_COBRAR, CUENTAS_POR_PAGAR, DEFINICIONES_CARTERA } from "./cartera.ts";
import type { CompraHecho, Hechos, VentaHecho } from "../tipos.ts";

// "Hoy", para estas pruebas, es el final del período pedido.
const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };

function venta(p: Partial<VentaHecho> & { total: number }): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? "2026-08-15",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "emitida",
    contacto_id: null,
    contacto_nombre: null,
    total: p.total,
    items: [],
  };
}

function compra(p: Partial<CompraHecho> & { total: number }): CompraHecho {
  return {
    id: p.id ?? "c1",
    fecha: p.fecha ?? "2026-08-15",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "registrada",
    proveedor_id: p.proveedor_id ?? null,
    proveedor_nombre: p.proveedor_nombre ?? null,
    total: p.total,
  };
}

test("todas son instantaneas: una cuenta por cobrar es de hoy, no de un período", () => {
  for (const def of DEFINICIONES_CARTERA) assert.equal(def.instantanea, true);
});

test("cuentas_por_cobrar suma lo emitido y lo en borrador, no lo ya cobrado ni lo anulado", () => {
  const hechos: Hechos = {
    ventas: [
      venta({ id: "v1", total: 500_000, estado: "emitida" }),
      venta({ id: "v2", total: 300_000, estado: "borrador" }),
      venta({ id: "v3", total: 1_000_000, estado: "cobrada" }),
      venta({ id: "v4", total: 2_000_000, estado: "anulada" }),
    ],
  };
  const [r] = calcular([CUENTAS_POR_COBRAR], hechos, AGOSTO);
  assert.equal(r.valor, 800_000);
});

test("cobros_demorados solo cuenta lo pendiente hace más de 30 días desde el fin del período", () => {
  const hechos: Hechos = {
    ventas: [
      venta({ id: "v1", total: 500_000, fecha: "2026-06-01" }), // 91 días antes del 31/08: demorado
      venta({ id: "v2", total: 300_000, fecha: "2026-08-20" }), // 11 días: no todavía
      venta({ id: "v3", total: 999_999, fecha: "2026-01-01", estado: "cobrada" }), // ya se cobró
    ],
  };
  const [r] = calcular([COBROS_DEMORADOS], hechos, AGOSTO);
  assert.equal(r.valor, 500_000);
});

test("sin ninguna venta pendiente, no hay moneda que informar", () => {
  const hechos: Hechos = { ventas: [venta({ id: "v1", total: 100, estado: "cobrada" })] };
  assert.deepEqual(calcular([CUENTAS_POR_COBRAR], hechos, AGOSTO), []);
  assert.deepEqual(calcular([COBROS_DEMORADOS], hechos, AGOSTO), []);
});

test("cuentas_por_pagar es el mismo criterio del lado de las compras", () => {
  const hechos: Hechos = {
    compras: [
      compra({ id: "c1", total: 400_000, estado: "registrada" }),
      compra({ id: "c2", total: 100_000, estado: "pagada" }),
      compra({ id: "c3", total: 900_000, estado: "anulada" }),
    ],
  };
  const [r] = calcular([CUENTAS_POR_PAGAR], hechos, AGOSTO);
  assert.equal(r.valor, 400_000);
});
