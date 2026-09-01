import { monedaConocida } from "../../finanzas/monedas.ts";
import { dentroDe } from "../periodo.ts";
import { valorConocido } from "../tipos.ts";
import type { DefinicionKPI, Hechos, Periodo, ValorKPI } from "../tipos.ts";

/**
 * Los totales crudos del período, separados de `balance_periodo`
 * (`lib/kpi/definiciones/ventas.ts`) para quien quiere el ingreso y el gasto
 * por separado y no solo la diferencia.
 */

function totalPorTipo(hechos: Hechos, periodo: Periodo, tipo: "ingreso" | "gasto"): ValorKPI[] {
  const movimientos = (hechos.movimientos ?? []).filter(
    (m) => m.tipo === tipo && dentroDe(m.fecha, periodo),
  );
  const monedas = new Set(movimientos.map((m) => monedaConocida(m.moneda)));

  return [...monedas].sort().map((moneda) => {
    const total = movimientos
      .filter((m) => monedaConocida(m.moneda) === moneda)
      .reduce((s, m) => s + m.monto, 0);
    return valorConocido(moneda, total);
  });
}

export const INGRESOS_TOTALES: DefinicionKPI = {
  id: "ingresos_totales",
  nombre: "Ingresos del período",
  familia: "finanzas",
  unidad: "moneda",
  direccion: "mas_es_mejor",
  necesita: ["movimientos"],
  calcular: (hechos, periodo) => totalPorTipo(hechos, periodo, "ingreso"),
};

export const GASTOS_TOTALES: DefinicionKPI = {
  id: "gastos_totales",
  nombre: "Gastos del período",
  familia: "finanzas",
  unidad: "moneda",
  direccion: "menos_es_mejor",
  necesita: ["movimientos"],
  calcular: (hechos, periodo) => totalPorTipo(hechos, periodo, "gasto"),
};

export const DEFINICIONES_FINANZAS: DefinicionKPI[] = [INGRESOS_TOTALES, GASTOS_TOTALES];
