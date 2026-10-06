/**
 * En qué está un fijo este mes (v232).
 *
 * Un fijo son tres cosas distintas que la pantalla tiene que poder separar:
 *
 * - el CONCEPTO ("internet, día 10, ₲ 230.000"), que es lo que se espera;
 * - el VENCIMIENTO de este mes, que existe aunque nadie haya hecho nada;
 * - el PAGO, que es un movimiento real y recién ahí cuenta como plata que salió.
 *
 * Antes de la v232 no había forma de atar un pago a su fijo, así que de los
 * meses anteriores no se sabe nada: se dicen "sin registro", nunca "vencido".
 * Afirmar que alguien no pagó algo que capaz pagó y no anotó sería inventar.
 */

export type EstadoDelMes = "registrado" | "vencido" | "pendiente" | "proximo";

export type MarcaDelMes = "pagado" | "sin_registro" | "vencido" | "pendiente" | "proximo";

export type PagoDeFijo = { periodo: string; fecha: string; monto: number; movimiento_id: string };

export type EstadoFijo = {
  periodo: string;
  vence_el: string;
  estado: EstadoDelMes;
  /** Días hasta el vencimiento (positivo) o desde que venció (negativo). */
  dias: number;
  pago: PagoDeFijo | null;
  /** Los dos meses anteriores y este, del más viejo al actual. */
  historial: { periodo: string; marca: MarcaDelMes }[];
};

/** Cuántos días antes del vencimiento se avisa que está por vencer. */
export const DIAS_AVISO = 7;

export function periodoDe(fechaIso: string): string {
  return `${fechaIso.slice(0, 7)}-01`;
}

function ultimoDia(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** El día del fijo dentro de un mes, sin pasarse del último (un "día 31" en febrero cae el 28 o 29). */
export function vencimientoEn(periodo: string, dia: number): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const d = Math.min(Math.max(1, Math.round(dia)), ultimoDia(anio, mes));
  return `${periodo.slice(0, 8)}${String(d).padStart(2, "0")}`;
}

export function periodoAnterior(periodo: string, meses = 1): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const total = anio * 12 + (mes - 1) - meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

export function estadoDelFijo(datos: { dia_del_mes: number; pagos: PagoDeFijo[]; hoy: string }): EstadoFijo {
  const periodo = periodoDe(datos.hoy);
  const venceEl = vencimientoEn(periodo, datos.dia_del_mes);
  const dias = diasEntre(datos.hoy, venceEl);
  const porPeriodo = new Map(datos.pagos.map((p) => [p.periodo, p]));
  const pago = porPeriodo.get(periodo) ?? null;

  const estado: EstadoDelMes = pago
    ? "registrado"
    : dias < 0
      ? "vencido"
      : dias <= DIAS_AVISO
        ? "pendiente"
        : "proximo";

  const historial = [2, 1].map((atras) => {
    const p = periodoAnterior(periodo, atras);
    return { periodo: p, marca: (porPeriodo.has(p) ? "pagado" : "sin_registro") as MarcaDelMes };
  });
  historial.push({ periodo, marca: pago ? "pagado" : (estado as MarcaDelMes) });

  return { periodo, vence_el: venceEl, estado, dias, pago, historial };
}

/**
 * El próximo vencimiento que todavía no está pagado.
 *
 * Lo usan las proyecciones: un fijo que ya se pagó este mes —aunque sea antes
 * del día— no tiene que volver a restarse hasta el mes que viene. Sin esto, el
 * pago adelantado se contaba dos veces: una como movimiento y otra como fijo
 * por venir.
 */
export function proximoVencimientoSinPagar(datos: {
  dia_del_mes: number;
  pagado_hasta: string | null | undefined;
  hoy: string;
}): string {
  let periodo = periodoDe(datos.hoy);
  let fecha = vencimientoEn(periodo, datos.dia_del_mes);

  if (fecha < datos.hoy || (datos.pagado_hasta && datos.pagado_hasta >= periodo)) {
    periodo = periodoAnterior(periodo, -1);
    fecha = vencimientoEn(periodo, datos.dia_del_mes);
  }

  // Pagado por adelantado más de un mes: se sigue corriendo.
  while (datos.pagado_hasta && datos.pagado_hasta >= periodo) {
    periodo = periodoAnterior(periodo, -1);
    fecha = vencimientoEn(periodo, datos.dia_del_mes);
  }

  return fecha;
}
