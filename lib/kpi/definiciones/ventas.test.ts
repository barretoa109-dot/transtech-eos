import assert from "node:assert/strict";
import test from "node:test";
import { calcular } from "../motor.ts";
import {
  BALANCE_PERIODO,
  DEFINICIONES_VENTAS,
  GANANCIA,
  MARGEN_BRUTO,
  ROI,
  TICKET_PROMEDIO,
  UNIDADES_POR_TICKET,
  VENTAS_NETAS,
} from "./ventas.ts";
import type { Hechos, VentaHecho } from "../tipos.ts";

const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };

function venta(p: Partial<VentaHecho> & { total: number; costo?: number | null }): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? "2026-08-15",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "emitida",
    contacto_id: p.contacto_id ?? null,
    contacto_nombre: p.contacto_nombre ?? null,
    // En estos fixtures la venta tiene un único ítem: la cabecera coincide.
    total: p.total,
    items: p.items ?? [
      {
        total: p.total,
        iva: 10,
        cantidad: 1,
        costo_unitario: p.costo ?? null,
        producto_id: null,
      },
    ],
  };
}

test("las definiciones que salen de calcularIndicadores declaran los mismos insumos", () => {
  for (const def of DEFINICIONES_VENTAS) {
    if (def.id === "unidades_por_ticket") continue; // cuenta directo sobre ventas, no pasa por indicadores.ts
    assert.deepEqual([...def.necesita].sort(), ["fijos", "movimientos", "ventas"]);
  }
});

test("los ids no se repiten", () => {
  const ids = DEFINICIONES_VENTAS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("ventas_netas pasa el neto de IVA, igual que indicadores.ts", () => {
  const hechos: Hechos = { ventas: [venta({ total: 110 })], movimientos: [], fijos: [] };
  const [r] = calcular([VENTAS_NETAS], hechos, AGOSTO);
  // 110 con IVA 10% -> 100 neto.
  assert.equal(r.valor, 100);
  assert.equal(r.moneda, "PYG");
});

test("sin ventas, ventas_netas no aparece: no hay moneda que informar", () => {
  const hechos: Hechos = { ventas: [], movimientos: [], fijos: [] };
  const resultados = calcular([VENTAS_NETAS], hechos, AGOSTO);
  assert.deepEqual(resultados, []);
});

test("ticket_promedio dice por qué es null cuando la única venta de esa moneda quedó fuera del período", () => {
  const hechos: Hechos = {
    ventas: [venta({ total: 110, fecha: "2026-06-01" })],
    movimientos: [],
    fijos: [],
  };
  const [r] = calcular([TICKET_PROMEDIO], hechos, AGOSTO);
  assert.equal(r.valor, null);
  assert.equal(r.estado, "sin_datos");
  assert.equal(r.falta, "Todavía no hay ventas registradas en el período");
});

test("ganancia y margen son null, con motivo, cuando ninguna venta tiene costo", () => {
  const hechos: Hechos = { ventas: [venta({ total: 110, costo: null })], movimientos: [], fijos: [] };

  const [g] = calcular([GANANCIA], hechos, AGOSTO);
  assert.equal(g.valor, null);
  assert.equal(g.estado, "sin_datos");
  assert.equal(g.falta, "Ninguna venta del período tiene costo cargado");

  const [m] = calcular([MARGEN_BRUTO], hechos, AGOSTO);
  assert.equal(m.valor, null);
});

test("con costo cargado, ganancia, margen y ROI salen de la misma cuenta neta", () => {
  // 110 (iva10) -> 100 neto vendido; costo unitario 33 (iva10) -> 30 neto.
  const hechos: Hechos = { ventas: [venta({ total: 110, costo: 33 })], movimientos: [], fijos: [] };

  const [g] = calcular([GANANCIA], hechos, AGOSTO);
  assert.equal(g.valor, 70);

  const [m] = calcular([MARGEN_BRUTO], hechos, AGOSTO);
  assert.equal(m.valor, 70); // 70/100 * 100

  const [roi] = calcular([ROI], hechos, AGOSTO);
  // 70 de ganancia sobre 30 de costo: por cada guaraní puesto, volvieron 2,33 más.
  assert.equal(roi.valor, (70 / 30) * 100);
});

test("balance_periodo es ingresos menos gastos, y nunca queda sin_datos", () => {
  const hechos: Hechos = {
    ventas: [],
    movimientos: [
      { fecha: "2026-08-05", moneda: "PYG", monto: 500_000, tipo: "ingreso" },
      { fecha: "2026-08-10", moneda: "PYG", monto: 200_000, tipo: "gasto" },
    ],
    fijos: [],
  };
  const [r] = calcular([BALANCE_PERIODO], hechos, AGOSTO);
  assert.equal(r.valor, 300_000);
  assert.equal(r.estado, "bien");
});

test("el motor calcula la tendencia de ventas_netas comparando contra el mes anterior, sin duplicar esa cuenta acá", () => {
  const hechos: Hechos = {
    ventas: [
      venta({ id: "v0", total: 110, fecha: "2026-07-10" }), // 100 neto en julio
      venta({ id: "v1", total: 220, fecha: "2026-08-10" }), // 200 neto en agosto
    ],
    movimientos: [],
    fijos: [],
  };
  const [r] = calcular([VENTAS_NETAS], hechos, AGOSTO);
  assert.equal(r.valor, 200);
  assert.equal(r.anterior, 100);
  assert.equal(r.tendencia, "sube");
  assert.equal(r.variacion_pct, 100);
});

test("unidades_por_ticket cuenta las unidades de todos los ítems, no las líneas", () => {
  const hechos: Hechos = {
    ventas: [
      venta({
        id: "v1",
        total: 330,
        items: [
          { total: 220, iva: 10, cantidad: 4, costo_unitario: null, producto_id: "p1" },
          { total: 110, iva: 10, cantidad: 2, costo_unitario: null, producto_id: "p2" },
        ],
      }),
      venta({ id: "v2", total: 110, items: [{ total: 110, iva: 10, cantidad: 3, costo_unitario: null, producto_id: "p1" }] }),
    ],
    movimientos: [],
    fijos: [],
  };
  const [r] = calcular([UNIDADES_POR_TICKET], hechos, AGOSTO);
  // (4+2) + 3 = 9 unidades entre 2 ventas.
  assert.equal(r.valor, 4.5);
});
