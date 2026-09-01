import { calcularIndicadores, type GastoIndicador, type Indicadores, type VentaIndicador } from "../../erp/indicadores.ts";
import { valorConocido, valorDesconocido } from "../tipos.ts";
import type { DefinicionKPI, Hechos, Periodo, ValorKPI } from "../tipos.ts";

/**
 * Ventas, margen, ROI y punto de equilibrio — tomados prestados, no repetidos.
 *
 * Este archivo no reimplementa la aritmética: la toma de
 * `lib/erp/indicadores.ts`, que ya la tiene probada (19 tests) y es la misma
 * que usa la pantalla de Rentabilidad. Lo que agrega es exponerla como
 * definiciones sueltas del motor, para que el motor le calcule tendencia y
 * estado una sola vez y de la misma forma para todos los indicadores.
 *
 * Por eso NO hay una definición `crecimiento_ventas` acá: es exactamente lo
 * que el motor calcula solo al comparar `ventas_netas` contra el período
 * anterior (`lib/kpi/motor.ts`). Calcularlo dos veces —adentro de
 * `calcularIndicadores` y otra vez en el motor— es la clase de duplicación
 * que este proyecto ya pagó cara una vez, cuando `Rentabilidad.tsx` y este
 * mismo módulo mostraban dos márgenes distintos de la misma plata.
 */

function movimientosDe(hechos: Hechos, tipo: "ingreso" | "gasto"): GastoIndicador[] {
  return (hechos.movimientos ?? [])
    .filter((m) => m.tipo === tipo)
    .map((m) => ({ fecha: m.fecha, moneda: m.moneda, monto: m.monto }));
}

function fijosDe(hechos: Hechos, periodo: Periodo): GastoIndicador[] {
  // calcularIndicadores no mira la fecha de un fijo mensual —son recurrentes
  // por definición—, solo su moneda. El campo existe por el tipo compartido
  // con los movimientos puntuales; periodo.desde es un valor de relleno.
  return (hechos.fijos ?? [])
    .filter((f) => f.tipo === "gasto")
    .map((f) => ({ fecha: periodo.desde, moneda: f.moneda, monto: f.monto }));
}

function ventasIndicador(hechos: Hechos): VentaIndicador[] {
  return (hechos.ventas ?? []).map((v) => ({
    fecha: v.fecha,
    moneda: v.moneda,
    contacto_id: v.contacto_id,
    contacto_nombre: v.contacto_nombre,
    items: v.items.map((it) => ({
      total: it.total,
      iva: it.iva,
      cantidad: it.cantidad,
      costo_unitario: it.costo_unitario,
    })),
  }));
}

/**
 * Corre `calcularIndicadores` una vez por llamada del motor (una por período,
 * dos en total por KPI pedido). No se cachea entre llamadas: son sumas sobre
 * los movimientos de uno o dos meses, no una consulta a la base, así que
 * recalcular es más barato que el mecanismo para evitarlo.
 */
function indicadoresDe(hechos: Hechos, periodo: Periodo): Indicadores[] {
  return calcularIndicadores({
    periodo,
    ventas: ventasIndicador(hechos),
    gastos: movimientosDe(hechos, "gasto"),
    ingresos: movimientosDe(hechos, "ingreso"),
    fijosMensuales: fijosDe(hechos, periodo),
  });
}

const NECESITA: DefinicionKPI["necesita"] = ["ventas", "movimientos", "fijos"];

function definir(
  datos: Pick<DefinicionKPI, "id" | "nombre" | "familia" | "unidad" | "direccion" | "umbrales">,
  leer: (i: Indicadores) => number | null,
  motivoSiNulo: string,
): DefinicionKPI {
  return {
    ...datos,
    necesita: NECESITA,
    calcular(hechos, periodo): ValorKPI[] {
      return indicadoresDe(hechos, periodo).map((i) => {
        const valor = leer(i);
        return valor === null
          ? valorDesconocido(i.moneda, motivoSiNulo)
          : valorConocido(i.moneda, valor);
      });
    },
  };
}

const SIN_VENTAS = "Todavía no hay ventas registradas en el período";
const SIN_COSTO = "Ninguna venta del período tiene costo cargado";

export const VENTAS_NETAS = definir(
  { id: "ventas_netas", nombre: "Ventas netas", familia: "ventas", unidad: "moneda", direccion: "mas_es_mejor" },
  (i) => i.ventas.neto,
  SIN_VENTAS,
);

export const TICKET_PROMEDIO = definir(
  { id: "ticket_promedio", nombre: "Ticket promedio", familia: "ventas", unidad: "moneda", direccion: "neutro" },
  (i) => i.ticket_promedio,
  SIN_VENTAS,
);

export const GANANCIA = definir(
  { id: "ganancia", nombre: "Ganancia", familia: "finanzas", unidad: "moneda", direccion: "mas_es_mejor" },
  (i) => i.ganancia,
  SIN_COSTO,
);

export const MARGEN_BRUTO = definir(
  {
    id: "margen_bruto",
    nombre: "Margen bruto",
    familia: "finanzas",
    unidad: "porcentaje",
    direccion: "mas_es_mejor",
    umbrales: { atencion: 20, alerta: 10 },
  },
  (i) => i.margen,
  SIN_COSTO,
);

export const ROI = definir(
  { id: "roi", nombre: "ROI de mercadería", familia: "finanzas", unidad: "porcentaje", direccion: "mas_es_mejor" },
  (i) => i.roi,
  SIN_COSTO,
);

export const PUNTO_EQUILIBRIO = definir(
  { id: "punto_equilibrio", nombre: "Punto de equilibrio", familia: "finanzas", unidad: "moneda", direccion: "neutro" },
  (i) => i.punto_equilibrio,
  "Necesita gastos fijos declarados y un margen positivo",
);

export const BALANCE_PERIODO = definir(
  { id: "balance_periodo", nombre: "Balance del período", familia: "finanzas", unidad: "moneda", direccion: "mas_es_mejor" },
  (i) => i.balance,
  "No se pudo calcular este valor.",
);

export const CONCENTRACION_CLIENTES = definir(
  {
    id: "concentracion_clientes",
    nombre: "Concentración del cliente principal",
    familia: "ventas",
    unidad: "porcentaje",
    direccion: "menos_es_mejor",
    umbrales: { atencion: 40, alerta: 60 },
  },
  (i) => i.concentracion?.porcentaje ?? null,
  SIN_VENTAS,
);

export const VENTAS_SIN_COSTO = definir(
  {
    id: "ventas_sin_costo",
    nombre: "Ventas sin costo cargado",
    familia: "ventas",
    unidad: "cantidad",
    direccion: "menos_es_mejor",
  },
  (i) => i.ventas_sin_costo,
  "No se pudo calcular este valor.",
);

export const DEFINICIONES_VENTAS: DefinicionKPI[] = [
  VENTAS_NETAS,
  TICKET_PROMEDIO,
  GANANCIA,
  MARGEN_BRUTO,
  ROI,
  PUNTO_EQUILIBRIO,
  BALANCE_PERIODO,
  CONCENTRACION_CLIENTES,
  VENTAS_SIN_COSTO,
];
