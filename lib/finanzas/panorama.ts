import { conciliar, type Conciliacion, type ResultadoConciliacion } from "./conciliacion.ts";
import { combinarSeries, type Fijo } from "./fijos.ts";
import { cuotasPendientes, sinDuplicar, type Deuda } from "./deudas.ts";
import {
  detectarSeries,
  proyectar,
  type MovimientoBase,
  type MovimientoProyectado,
  type SerieRecurrente,
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
 * Lo consumen el panel (`app/api/finanzas/estado`) y la alerta
 * (`app/api/finanzas/riesgo`). Que sea el MISMO armado para los dos no es
 * prolijidad: mientras cada uno sumaba lo suyo, el panel no contaba las cuotas
 * de las deudas y la alerta sí, así que las dos pantallas daban números
 * distintos sobre la misma plata y una de las dos estaba mintiendo.
 */

/**
 * De dónde salió cada egreso.
 *
 * El panel los muestra separados porque no significan lo mismo para quien
 * lee: "compromisos" es lo que el usuario ya sabe que debe, "previsibles" es
 * lo que EOS dedujo solo, y "cuotas" es lo que ya estaba pactado con un
 * tercero. Mezclarlos en un total único obligaría al usuario a confiar sin
 * poder verificar de dónde salió el descuento.
 */
export type FuenteEgreso = "anotado" | "previsible" | "cuota";

export type EgresoPanorama = MovimientoProyectado & { fuente: FuenteEgreso };

export type Panorama = {
  /** El saldo del que se parte, ya corregido por conciliación. */
  saldoActual: number;
  /** La línea que el usuario pidió no cruzar. */
  reservaMinima: number;
  egresos: EgresoPanorama[];
  ingresos: MovimientoProyectado[];
  /** Detectadas y declaradas ya combinadas, para no recalcularlas afuera. */
  series: SerieRecurrente[];
  /** Solo lo que EOS dedujo de los movimientos, que el panel informa aparte. */
  detectadas: SerieRecurrente[];
  /**
   * De dónde partió el saldo y cuánta plata se va sin que EOS la vea.
   *
   * Se devuelve en vez de quedar adentro porque el panel tiene que poder
   * decirle al usuario qué tan seguro está de lo que le está mostrando. Un
   * número sin su grado de confianza al lado se lee como certeza.
   */
  conciliacion: ResultadoConciliacion;
  /** Lo que efectivamente entró y salió desde ese punto confiable. */
  aplicado: { ingresos: number; gastos: number };
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

  const detectadas = detectarSeries(movimientos);
  const series = combinarSeries(detectadas, fijos, hoy);
  const futuros = movimientos.filter((m) => m.fecha > hoy);

  const previsibles: EgresoPanorama[] = proyectar(
    series.filter((s) => s.tipo !== "ingreso"),
    { desde: hoy, hasta, yaRegistrados: futuros },
  ).map((p) => ({ ...p, fuente: "previsible" }));

  // Los compromisos ya anotados a futuro son egresos ciertos, no proyecciones.
  const anotados: EgresoPanorama[] = futuros
    .filter((m) => m.tipo === "compromiso" || m.tipo === "gasto")
    .map((m) => ({
      tipo: "gasto",
      descripcion: m.descripcion ?? "Compromiso",
      monto: m.monto,
      fecha: m.fecha,
      periodicidad: "mensual",
      confianza: 1,
      fuente: "anotado",
    }));

  // Las cuotas se agregan al final y filtradas: si el débito de la cuota
  // además viene detectado como serie, sumarla otra vez descontaría dos veces
  // la misma plata y produciría una alerta que no corresponde.
  const cuotas: EgresoPanorama[] = sinDuplicar(
    cuotasPendientes(deudas, { desde: hoy, hasta }),
    [...previsibles, ...anotados],
  ).map((c) => ({ ...c, fuente: "cuota" }));

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
    series,
    detectadas,
    conciliacion: estado,
    aplicado: { ingresos: entraron, gastos: salieron },
  };
}
