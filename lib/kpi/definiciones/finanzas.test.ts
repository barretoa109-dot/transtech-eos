import assert from "node:assert/strict";
import test from "node:test";
import { calcular } from "../motor.ts";
import { GASTOS_TOTALES, INGRESOS_TOTALES } from "./finanzas.ts";
import type { Hechos } from "../tipos.ts";

const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };

test("ingresos_totales suma solo los ingresos del período, por moneda", () => {
  const hechos: Hechos = {
    movimientos: [
      { fecha: "2026-08-05", moneda: "PYG", monto: 500_000, tipo: "ingreso" },
      { fecha: "2026-08-10", moneda: "PYG", monto: 200_000, tipo: "gasto" },
      { fecha: "2026-08-12", moneda: "USD", monto: 100, tipo: "ingreso" },
      { fecha: "2026-07-01", moneda: "PYG", monto: 999_999, tipo: "ingreso" }, // fuera del período
    ],
  };
  const resultados = calcular([INGRESOS_TOTALES], hechos, AGOSTO);
  assert.equal(resultados.find((r) => r.moneda === "PYG")?.valor, 500_000);
  assert.equal(resultados.find((r) => r.moneda === "USD")?.valor, 100);
});

test("gastos_totales es menos_es_mejor: más gasto es peor, no mejor", () => {
  const hechos: Hechos = {
    movimientos: [{ fecha: "2026-08-05", moneda: "PYG", monto: 200_000, tipo: "gasto" }],
  };
  const [r] = calcular([GASTOS_TOTALES], hechos, AGOSTO);
  assert.equal(r.valor, 200_000);
  assert.equal(r.direccion, "menos_es_mejor");
});

test("sin movimientos, no hay moneda que informar", () => {
  assert.deepEqual(calcular([INGRESOS_TOTALES], { movimientos: [] }, AGOSTO), []);
});
