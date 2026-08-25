import { conciliar, type Conciliacion } from "./conciliacion.ts";
import { combinarSeries, type Fijo } from "./fijos.ts";
import { cuotasPendientes, sinDuplicar, type Deuda } from "./deudas.ts";
import {
  detectarSeries,
  proyectar,
  type MovimientoBase,
  type MovimientoProyectado,
} from "./recurrencia.ts";

/**
 * Todo lo que EOS sabe que va a pasar con la plata del usuario, en una sola
 * línea de tiempo.
 *
 * Reúne las cuatro fuentes que hoy viven separadas:
 *
 *   1. lo que ya está cargado a futuro (compromisos anotados),
 *   2. lo que se repite y EOS detectó solo (series),
 *   3. lo que el usuario declaró como fijo,
 *   4. las cuotas de sus deudas.
 *
 * Es puro a propósito: recibe filas ya leídas y no toca la base. Así se puede
 * probar la matemática del dinero sin una sesión, que es la única forma de
 * tener tests sobre ella.
 *
 * Nota para quien venga después: `app/api/finanzas/estado` hace un armado
 * parecido en línea. No se unificó todavía porque ese archivo estaba en manos
 * de otra tarea; cuando se estabilice, debería consumir esto.
 */

export type Panorama = {
  /** El saldo del que se parte, ya corregido por conciliación. */
  saldoActual: number;
  /** La línea que el usuario pidió no cruzar. */
  reservaMinima: number;
  egresos: MovimientoProyectado[];
  ingresos: MovimientoProyectado[];
};

export function armarPanorama(datos: {
  hoy: string;
  hasta: string;
  saldoInicial: number;
  saldoInicialFecha: string;
  reservaMinima: number;
  movimientos: MovimientoBase[];
  conciliaciones: Conciliacion[];
  fijos: Fijo[];
  deudas: Deuda[];
}): Panorama {
  const { hoy, hasta, movimientos, fijos, deudas } = datos;

  const estado = conciliar({
    saldoInicial: datos.saldoInicial,
    saldoInicialFecha: datos.saldoInicialFecha,
    conciliaciones: datos.conciliaciones,
    movimientos,
    hoy,
  });

  const aplicados = movimientos.filter((m) => m.fecha > estado.desde && m.fecha <= hoy);
  const entraron = aplicados
    .filter((m) => m.tipo === "ingreso")
    .reduce((t, m) => t + m.monto, 0);
  const salieron = aplicados.filter((m) => m.tipo === "gasto").reduce((t, m) => t + m.monto, 0);

  // El gasto invisible —billetera, efectivo— también se descuenta acá: si no,
  // la simulación arrancaría con más plata de la que el usuario tiene y el
  // aviso llegaría tarde.
  const saldoActual = estado.base + entraron - salieron - estado.gasto_invisible;

  const series = combinarSeries(detectarSeries(movimientos), fijos, hoy);
  const futuros = movimientos.filter((m) => m.fecha > hoy);

  const previsibles = proyectar(
    series.filter((s) => s.tipo !== "ingreso"),
    { desde: hoy, hasta, yaRegistrados: futuros },
  );

  // Los compromisos ya anotados a futuro son egresos ciertos, no proyecciones.
  const anotados: MovimientoProyectado[] = futuros
    .filter((m) => m.tipo === "compromiso" || m.tipo === "gasto")
    .map((m) => ({
      tipo: "gasto",
      descripcion: m.descripcion ?? "Compromiso",
      monto: m.monto,
      fecha: m.fecha,
      periodicidad: "mensual",
      confianza: 1,
    }));

  // Las cuotas se agregan al final y filtradas: si el débito de la cuota
  // además viene detectado como serie, sumarla otra vez descontaría dos veces
  // la misma plata y produciría una alerta que no corresponde.
  const cuotas = sinDuplicar(cuotasPendientes(deudas, { desde: hoy, hasta }), [
    ...previsibles,
    ...anotados,
  ]);

  const ingresos = proyectar(
    series.filter((s) => s.tipo === "ingreso"),
    { desde: hoy, hasta, yaRegistrados: futuros },
  );

  return {
    saldoActual,
    reservaMinima: datos.reservaMinima,
    egresos: [...previsibles, ...anotados, ...cuotas].sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    ),
    ingresos,
  };
}
