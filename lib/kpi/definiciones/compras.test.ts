import assert from "node:assert/strict";
import test from "node:test";
import { calcular } from "../motor.ts";
import { CONCENTRACION_PROVEEDOR, GASTO_COMPRAS } from "./compras.ts";
import type { CompraHecho, Hechos } from "../tipos.ts";

const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };

function compra(p: Partial<CompraHecho> & { total: number }): CompraHecho {
  return {
    id: p.id ?? "c1",
    fecha: p.fecha ?? "2026-08-15",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "registrada",
    proveedor_id: p.proveedor_id ?? null,
    proveedor_nombre: p.proveedor_nombre ?? null,
    total: p.total,
    vence_el: p.vence_el ?? null,
    cobrado: p.cobrado ?? 0,
  };
}

test("gasto_compras suma lo comprado en el período, sin lo anulado", () => {
  const hechos: Hechos = {
    compras: [
      compra({ id: "c1", total: 500_000 }),
      compra({ id: "c2", total: 300_000, estado: "pagada" }),
      compra({ id: "c3", total: 999_999, estado: "anulada" }),
      compra({ id: "c4", total: 111_111, fecha: "2026-07-01" }), // fuera del período
    ],
  };
  const [r] = calcular([GASTO_COMPRAS], hechos, AGOSTO);
  assert.equal(r.valor, 800_000);
});

test("concentracion_proveedor agrupa por proveedor, no por compra", () => {
  const hechos: Hechos = {
    compras: [
      compra({ id: "c1", total: 700_000, proveedor_id: "p1" }),
      compra({ id: "c2", total: 200_000, proveedor_id: "p1" }),
      compra({ id: "c3", total: 100_000, proveedor_id: "p2" }),
    ],
  };
  const [r] = calcular([CONCENTRACION_PROVEEDOR], hechos, AGOSTO);
  // p1 concentra 900.000 de 1.000.000 -> 90%.
  assert.equal(r.valor, 90);
  assert.equal(r.estado, "alerta");
});

test("fuera del período, la moneda ni aparece: no hay dato que atribuirle", () => {
  const hechos: Hechos = { compras: [compra({ id: "c1", total: 100, fecha: "2026-01-01" })] };
  assert.deepEqual(calcular([CONCENTRACION_PROVEEDOR], hechos, AGOSTO), []);
});

test("con compras del período pero de total cero, dice por qué en vez de dividir por cero", () => {
  const hechos: Hechos = { compras: [compra({ id: "c1", total: 0 })] };
  const [r] = calcular([CONCENTRACION_PROVEEDOR], hechos, AGOSTO);
  assert.equal(r.valor, null);
  assert.equal(r.falta, "Sin compras en el período");
});

test("compras sin proveedor asignado se agrupan aparte, no se pierden", () => {
  const hechos: Hechos = {
    compras: [
      compra({ id: "c1", total: 500_000, proveedor_id: null }),
      compra({ id: "c2", total: 500_000, proveedor_id: "p1" }),
    ],
  };
  const [r] = calcular([CONCENTRACION_PROVEEDOR], hechos, AGOSTO);
  assert.equal(r.valor, 50);
});
