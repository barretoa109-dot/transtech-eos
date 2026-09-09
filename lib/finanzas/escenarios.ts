import { formatearMonto } from "./formato.ts";

/**
 * "¿Puedo comprar esto?"
 *
 * ============================================================
 * POR QUÉ EL SALDO NO ALCANZA PARA CONTESTAR
 * ============================================================
 *
 * Tener 3.000.000 en la cuenta no significa poder gastar 3.000.000. Antes de
 * eso están las obligaciones que caen hasta el próximo cobro, la reserva que la
 * persona pidió no tocar, y lo que sus objetivos necesitan por mes.
 *
 * Este módulo contesta con las cuatro cosas a la vista, y —lo más importante—
 * dice **qué se rompe** si la compra se hace igual: si toca la reserva, si deja
 * una obligación sin cubrir, si atrasa un objetivo, y en cuántos días vuelve a
 * entrar plata.
 *
 * ============================================================
 * UN ESCENARIO NO TOCA NADA
 * ============================================================
 *
 * Es una función pura sobre una copia del estado. No escribe en la base, no
 * registra un movimiento y no cambia ningún panel. Preguntarle a EOS "¿puedo
 * comprar una notebook?" no puede dejar rastro de una notebook que nadie
 * compró.
 *
 * ============================================================
 * ANTES → ESCENARIO → CONSECUENCIA
 * ============================================================
 *
 * Las tres partes vuelven separadas y con sus números, para que la persona
 * pueda no estar de acuerdo con el veredicto y seguir usando la cuenta. Un
 * "no podés" sin el cálculo al lado es una orden; con el cálculo es una
 * conversación.
 *
 * Cada consecuencia viene como una frase COMPLETA, con su monto ya escrito.
 * Partirla en plantilla y datos obligaría a la pantalla a saber el orden de
 * las palabras de cada caso, que es justo lo que este módulo entiende y la
 * pantalla no.
 */

export type Antes = {
  /** En qué moneda está todo esto. Nunca se mezclan ni se convierten. */
  moneda: string;
  /** Lo que hay hoy, ya descontados compromisos, reserva y ahorro. */
  disponible_real: number;
  /** El saldo estimado sin descontar nada. */
  saldo: number;
  /** La línea que pidió no cruzar. */
  reserva: number;
  /** Lo que ya tiene dueño antes del próximo cobro. */
  comprometido: number;
  /** Cuándo vuelve a entrar plata. `null` si EOS no lo sabe. */
  proximo_ingreso: { fecha: string; monto: number } | null;
  /** Lo que sus objetivos necesitan por mes. */
  aporte_objetivos: number;
};

export type Consecuencia = {
  /** Qué pasa, en una línea. */
  titulo: string;
  /** El número que lo sostiene. */
  detalle: string;
  gravedad: "impide" | "advierte" | "informa";
};

export type Escenario = {
  monto: number;
  /** En cuántas cuotas la piensa pagar. 1 es al contado. */
  cuotas: number;
  /** Lo que sale este mes. */
  sale_ahora: number;

  antes: Antes;
  /** Cómo quedaría el disponible real después. */
  disponible_despues: number;
  /** Cómo quedaría el saldo después. */
  saldo_despues: number;

  /** El veredicto, que es un resumen de las consecuencias y no un juicio. */
  veredicto: "entra" | "entra_justo" | "no_entra";
  consecuencias: Consecuencia[];
  /**
   * Cuánto podría gastar sin romper nada. Es la respuesta útil cuando la
   * respuesta a lo que preguntó es que no.
   */
  hasta_cuanto: number;
  /**
   * Cuándo sí podría, si ahorrara lo que le sobra por mes. `null` cuando no
   * hay con qué estimarlo o cuando ya puede.
   */
  cuando_si: string | null;
  confianza: { nivel: number; motivos: string[] };
};

/**
 * Por debajo de qué proporción del disponible una compra deja de ser cómoda.
 *
 * No es una regla de oro: es el punto en que la compra se lleva casi todo el
 * margen y cualquier imprevisto del mes ya no entra. Se declara acá para que
 * se pueda discutir, y solo produce una advertencia, nunca un "no".
 */
const MARGEN_QUE_INCOMODA = 0.15;

export function simularCompra(datos: {
  hoy: string;
  antes: Antes;
  monto: number;
  /** En cuántas cuotas. 1 o menos es al contado. */
  cuotas?: number;
  /** Lo que le sobra por mes, para decir cuándo sí. `null` si no se sabe. */
  margenMensual?: number | null;
}): Escenario {
  const { antes, hoy } = datos;
  const moneda = (valor: number) => formatearMonto(valor, antes.moneda);
  const cuotas = Math.max(1, Math.round(datos.cuotas ?? 1));
  const monto = Math.max(0, datos.monto);
  const saleAhora = redondear(monto / cuotas);

  const disponibleDespues = redondear(antes.disponible_real - saleAhora);
  const saldoDespues = redondear(antes.saldo - saleAhora);

  const consecuencias: Consecuencia[] = [];

  /*
   * El orden importa: lo que IMPIDE va antes que lo que advierte. Quien lee la
   * primera línea tiene que encontrar ahí lo más grave, no lo más llamativo.
   */
  if (saldoDespues < antes.reserva) {
    consecuencias.push({
      titulo: "Te comería la reserva que pediste no tocar",
      detalle: `Quedarías con ${moneda(saldoDespues)} y tu reserva es ${moneda(antes.reserva)}.`,
      gravedad: "impide",
    });
  }

  if (saldoDespues < antes.comprometido + antes.reserva && antes.comprometido > 0) {
    consecuencias.push({
      titulo: "No te alcanzaría para lo que ya está comprometido",
      detalle: `Antes del próximo cobro salen ${moneda(antes.comprometido)} y te quedarían ${moneda(saldoDespues)}.`,
      gravedad: "impide",
    });
  }

  if (disponibleDespues < 0 && saldoDespues >= antes.reserva) {
    consecuencias.push({
      titulo: "Saldría del ahorro que apartaste",
      detalle: `Te pasarías ${moneda(Math.abs(disponibleDespues))} de lo que tenías libre este mes.`,
      gravedad: "advierte",
    });
  }

  if (antes.aporte_objetivos > 0 && disponibleDespues < antes.aporte_objetivos) {
    consecuencias.push({
      titulo: "Este mes tus objetivos no avanzarían",
      detalle: `Necesitan ${moneda(antes.aporte_objetivos)} por mes y te quedarían ${moneda(Math.max(0, disponibleDespues))}.`,
      gravedad: "advierte",
    });
  }

  if (
    disponibleDespues >= 0 &&
    antes.disponible_real > 0 &&
    disponibleDespues < antes.disponible_real * MARGEN_QUE_INCOMODA
  ) {
    consecuencias.push({
      titulo: "Te quedarías sin margen para un imprevisto",
      detalle: `Te sobrarían ${moneda(disponibleDespues)} hasta ${antes.proximo_ingreso?.fecha ?? "tu próximo cobro"}.`,
      gravedad: "advierte",
    });
  }

  if (antes.proximo_ingreso !== null) {
    consecuencias.push({
      titulo: `Volvés a cobrar el ${antes.proximo_ingreso.fecha}`,
      detalle: `Entran ${moneda(antes.proximo_ingreso.monto)}.`,
      gravedad: "informa",
    });
  }

  if (cuotas > 1) {
    consecuencias.push({
      titulo: `Quedarías comprometido ${cuotas} meses`,
      detalle: `${moneda(saleAhora)} por mes. No sé si tu financiación tiene interés: eso lo dice tu contrato.`,
      gravedad: "informa",
    });
  }

  const impide = consecuencias.some((c) => c.gravedad === "impide");
  const advierte = consecuencias.some((c) => c.gravedad === "advierte");

  /*
   * Hasta cuánto podría gastar sin romper nada duro: lo que hay por encima de
   * la reserva y de lo comprometido. No se le descuenta el aporte a los
   * objetivos, porque atrasar un objetivo es una decisión legítima y no un
   * impedimento — aparece como advertencia, no como techo.
   */
  const techo = redondear(Math.max(0, antes.saldo - antes.reserva - antes.comprometido));

  const margen = datos.margenMensual ?? null;
  const cuandoSi =
    impide && margen !== null && margen > 0 && monto > techo
      ? sumarMeses(hoy, Math.ceil((monto - techo) / margen))
      : null;

  return {
    monto,
    cuotas,
    sale_ahora: saleAhora,
    antes,
    disponible_despues: disponibleDespues,
    saldo_despues: saldoDespues,
    veredicto: impide ? "no_entra" : advierte ? "entra_justo" : "entra",
    consecuencias,
    hasta_cuanto: techo,
    cuando_si: cuandoSi,
    confianza: confianzaDe(antes),
  };
}

function confianzaDe(antes: Antes): { nivel: number; motivos: string[] } {
  const motivos: string[] = [];
  let nivel = 1;

  if (antes.proximo_ingreso === null) {
    nivel -= 0.3;
    motivos.push("no sé cuándo volvés a cobrar, así que estoy mirando solo lo que tenés hoy");
  }

  if (antes.comprometido === 0) {
    nivel -= 0.2;
    motivos.push("no tengo cargado ningún gasto fijo ni cuota, así que puede haber salidas que no veo");
  }

  return { nivel: Math.max(0, Number(nivel.toFixed(2))), motivos };
}


function sumarMeses(iso: string, meses: number): string {
  const [anio, mes, dia] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes + meses, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes - 1 + meses, Math.min(dia, ultimo))).toISOString().slice(0, 10);
}

function redondear(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0;
}
