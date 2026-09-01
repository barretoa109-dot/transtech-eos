import { sinIva } from "./margen.ts";
import type { TasaIva } from "./impuestos.ts";
import { monedaConocida } from "../finanzas/monedas.ts";

/**
 * Los números con los que se dirige un negocio.
 *
 * ============================================================
 * QUÉ SE PUEDE CALCULAR CON LO QUE EOS TIENE, Y QUÉ NO
 * ============================================================
 *
 * La lista de indicadores que usa una corporación es larga y buena parte no se
 * puede calcular sin cosas que EOS no tiene: patrimonio, deuda de largo plazo,
 * amortizaciones, capital de trabajo declarado. Inventarlos con lo que hay
 * sería el error más caro posible — un ROE falso se ve exactamente igual que
 * uno verdadero, y se toman decisiones sobre él.
 *
 * Así que este módulo calcula lo que sale de datos reales, y `loQueFalta()`
 * dice qué más habría y qué haría falta cargar para tenerlo. Un tablero que
 * admite lo que no sabe vale más que uno que llena todos los casilleros.
 *
 * ============================================================
 * TODO NETO DE IVA, TODO POR MONEDA
 * ============================================================
 *
 * Dos reglas que ya cuestan caro en este proyecto y no se repiten por gusto:
 *
 *   · Los precios llevan el IVA adentro y el IVA no es del negocio. Un ticket
 *     promedio bruto está inflado un 9%, y sobre él se decide si conviene
 *     abrir los domingos.
 *   · Nunca se suman dos monedas. Cada indicador sale una vez por moneda.
 */

/**
 * Una línea de la venta, que es donde vive el IVA.
 *
 * El desglose va por ítem y no por venta porque una misma venta puede mezclar
 * tasas —un producto al 10% y otro exento es lo más común del mundo— y sacarle
 * el IVA al total con una sola tasa daría un neto equivocado en toda venta
 * mixta. Poco, pero equivocado siempre para el mismo lado.
 */
export type ItemIndicador = {
  /** Total de la línea, con IVA adentro. */
  total: number;
  iva: TasaIva;
  cantidad: number;
  /** Costo unitario con IVA, si se conoce. */
  costo_unitario: number | null;
};

export type VentaIndicador = {
  fecha: string;
  moneda: string | null;
  contacto_id: string | null;
  contacto_nombre: string | null;
  items: ItemIndicador[];
};

export type GastoIndicador = {
  fecha: string;
  moneda: string | null;
  monto: number;
};

export type Periodo = { desde: string; hasta: string };

export type Indicadores = {
  moneda: string;
  ventas: { cantidad: number; neto: number };
  /** Neto de IVA. Null cuando ninguna venta tiene costo cargado. */
  ganancia: number | null;
  margen: number | null;
  /** Por cada guaraní puesto en mercadería, cuánto volvió además de él. */
  roi: number | null;
  ticket_promedio: number | null;
  /** Ingresos menos egresos del período, de los movimientos reales. */
  balance: number;
  /** Contra el período anterior de igual largo. Null sin período previo. */
  crecimiento_ventas: number | null;
  /** Cuánto pesa el cliente más grande. Un negocio de un solo cliente es frágil. */
  concentracion: { nombre: string; porcentaje: number } | null;
  /** Cuánto hay que vender por mes para cubrir los gastos fijos. */
  punto_equilibrio: number | null;
  /** Lo que se calculó con costos incompletos se dice, no se disimula. */
  ventas_sin_costo: number;
};

function dias(desde: string, hasta: string): number {
  return (
    Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1
  );
}

function correr(fecha: string, cantidadDias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + cantidadDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** El período anterior, del mismo largo y pegado al que se pide. */
export function periodoAnterior(periodo: Periodo): Periodo {
  const largo = dias(periodo.desde, periodo.hasta);

  return {
    desde: correr(periodo.desde, -largo),
    hasta: correr(periodo.desde, -1),
  };
}

const dentro = (fecha: string, p: Periodo) => fecha >= p.desde && fecha <= p.hasta;

export function calcularIndicadores(datos: {
  periodo: Periodo;
  ventas: VentaIndicador[];
  gastos: GastoIndicador[];
  ingresos: GastoIndicador[];
  /** Gastos fijos mensuales declarados, por moneda. Para el punto de equilibrio. */
  fijosMensuales: GastoIndicador[];
}): Indicadores[] {
  const monedas = new Set<string>();
  for (const v of datos.ventas) monedas.add(monedaConocida(v.moneda));
  for (const g of datos.gastos) monedas.add(monedaConocida(g.moneda));
  for (const i of datos.ingresos) monedas.add(monedaConocida(i.moneda));

  const anterior = periodoAnterior(datos.periodo);

  return [...monedas].sort().map((moneda) => {
    const esta = (m: { moneda: string | null }) => monedaConocida(m.moneda) === moneda;

    const ventasPeriodo = datos.ventas.filter((v) => esta(v) && dentro(v.fecha, datos.periodo));
    const ventasAntes = datos.ventas.filter((v) => esta(v) && dentro(v.fecha, anterior));

    /*
     * El neto de cada venta, no el bruto, y línea por línea.
     *
     * Es la diferencia entre "vendiste 10 millones" y "te quedaron 9,09
     * millones antes de pagar nada". El resto del módulo cuelga de acá, así
     * que si esto estuviera mal todos los indicadores estarían inflados el
     * mismo 9% y ninguno lo delataría.
     */
    const netoDe = (v: VentaIndicador) =>
      v.items.reduce((s, it) => s + sinIva(it.total, it.iva), 0);

    /** Solo las líneas que tienen costo: las demás no se pueden costear. */
    const costeadasDe = (v: VentaIndicador) =>
      v.items.filter((it) => it.costo_unitario !== null && it.costo_unitario > 0);

    const neto = ventasPeriodo.reduce((s, v) => s + netoDe(v), 0);
    const netoAntes = ventasAntes.reduce((s, v) => s + netoDe(v), 0);

    const conCosto = ventasPeriodo.filter((v) => costeadasDe(v).length > 0);

    const netoConCosto = conCosto.reduce(
      (s, v) => s + costeadasDe(v).reduce((t, it) => t + sinIva(it.total, it.iva), 0),
      0,
    );

    const costoNeto = conCosto.reduce(
      (s, v) =>
        s +
        costeadasDe(v).reduce(
          (t, it) => t + sinIva(Number(it.costo_unitario) * it.cantidad, it.iva),
          0,
        ),
      0,
    );

    /*
     * La ganancia solo se calcula sobre las ventas que TIENEN costo.
     *
     * Mezclar las que no lo tienen contaría su costo como cero y daría una
     * ganancia enorme y falsa. Se informa cuántas quedaron afuera para que el
     * usuario sepa qué le falta cargar.
     */
    const hayCosto = conCosto.length > 0;
    const ganancia = hayCosto ? netoConCosto - costoNeto : null;

    const ingresosPeriodo = datos.ingresos
      .filter((m) => esta(m) && dentro(m.fecha, datos.periodo))
      .reduce((s, m) => s + m.monto, 0);

    const gastosPeriodo = datos.gastos
      .filter((m) => esta(m) && dentro(m.fecha, datos.periodo))
      .reduce((s, m) => s + m.monto, 0);

    // ---------- Concentración de clientes ----------
    const porCliente = new Map<string, { nombre: string; neto: number }>();
    for (const v of ventasPeriodo) {
      const clave = v.contacto_id ?? "sin-cliente";
      const previo = porCliente.get(clave);
      porCliente.set(clave, {
        nombre: v.contacto_nombre ?? "Consumidor final",
        neto: (previo?.neto ?? 0) + netoDe(v),
      });
    }

    const mayor = [...porCliente.values()].sort((a, b) => b.neto - a.neto)[0];

    // ---------- Punto de equilibrio ----------
    //
    // Cuánto hay que VENDER por mes para que el margen cubra los gastos fijos.
    // Sin margen conocido no se puede: dividir por cero daría infinito, y
    // mostrar "necesitás vender ∞" es peor que no mostrar nada.
    const fijos = datos.fijosMensuales.filter(esta).reduce((s, m) => s + m.monto, 0);
    const margen = hayCosto && netoConCosto > 0 ? (ganancia as number) / netoConCosto : null;
    const puntoEquilibrio = margen !== null && margen > 0 && fijos > 0 ? fijos / margen : null;

    return {
      moneda,
      ventas: { cantidad: ventasPeriodo.length, neto },
      ganancia,
      margen: margen === null ? null : margen * 100,
      roi: hayCosto && costoNeto > 0 ? ((ganancia as number) / costoNeto) * 100 : null,
      ticket_promedio: ventasPeriodo.length > 0 ? neto / ventasPeriodo.length : null,
      balance: ingresosPeriodo - gastosPeriodo,
      // Sin ventas antes, "creció infinito" no significa nada: se calla.
      crecimiento_ventas: netoAntes > 0 ? ((neto - netoAntes) / netoAntes) * 100 : null,
      concentracion:
        mayor && neto > 0
          ? { nombre: mayor.nombre, porcentaje: (mayor.neto / neto) * 100 }
          : null,
      punto_equilibrio: puntoEquilibrio,
      ventas_sin_costo: ventasPeriodo.length - conCosto.length,
    };
  });
}

/**
 * Los indicadores que un contador va a pedir y EOS todavía no puede dar.
 *
 * Va acá y no en un comentario porque es información para el usuario, no para
 * quien programa: sirve para que sepa qué le falta cargar, y para que no crea
 * que el tablero está completo cuando no lo está.
 */
export function loQueFalta(): { indicador: string; necesita: string }[] {
  return [
    {
      indicador: "Rotación de inventario",
      necesita: "El stock valorizado al inicio y al final del período. Hoy el stock es un saldo del momento, sin historia.",
    },
    {
      indicador: "Liquidez corriente y prueba ácida",
      necesita: "Separar el activo y el pasivo corriente. EOS conoce las cuentas por cobrar y por pagar, pero no el resto del balance.",
    },
    {
      indicador: "ROE y ROA",
      necesita: "El patrimonio y el activo total del negocio, que nadie declaró todavía.",
    },
    {
      indicador: "EBITDA",
      necesita: "Distinguir intereses, impuestos, depreciación y amortización dentro de los gastos. Hoy son todos gastos.",
    },
    {
      indicador: "Ciclo de conversión de efectivo",
      necesita: "Fechas de vencimiento en las cuentas por cobrar y por pagar. Llegan con la cuenta corriente.",
    },
  ];
}
