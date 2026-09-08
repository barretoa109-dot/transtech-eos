import { sumarDias } from "../fecha.ts";
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
 * Cuántos días hacia atrás se miran los pagos ya hechos para no proyectar una
 * cuota que ya se pagó. Diez cubre lo pagado con anticipación y con atraso.
 */
const DIAS_DE_PAGOS_RECIENTES = 10;

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
  /**
   * Lo que efectivamente entró y salió desde ese punto confiable.
   *
   * Van los totales Y las listas que los componen, más la ventana de fechas
   * que las define. Es lo que le permite al panel llevar al usuario desde
   * cualquier cifra hasta los movimientos que la forman, con la garantía de
   * que el detalle suma exactamente el total porque es el mismo array.
   */
  aplicado: {
    ingresos: number;
    gastos: number;
    entradas: MovimientoBase[];
    salidas: MovimientoBase[];
    /** Exclusivo: el punto de partida confiable no se cuenta a sí mismo. */
    desde: string;
    /** Inclusivo. */
    hasta: string;
  };
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
  /**
   * Lo que las tarjetas van a sacar del bolsillo, ya calculado por
   * `lib/finanzas/tarjetas.ts::obligacionesDe`.
   *
   * Viene resuelto de afuera a propósito: el ciclo de una tarjeta —cierre,
   * vencimiento, resumen, cuotas— no tiene por qué vivir acá, y lo único que
   * este módulo necesita es cuándo y cuánto sale.
   *
   * Entra por el MISMO `sinDuplicar` que las cuotas de deuda, y por eso una
   * tarjeta cargada también como deuda, o un "pagué la tarjeta" ya anotado, no
   * la descuentan dos veces.
   */
  obligacionesTarjeta?: MovimientoProyectado[];
}): Panorama {
  const { hoy, hasta, movimientos, fijos, deudas } = datos;

  const estado = conciliar({
    saldoInicial: datos.saldoInicial,
    saldoInicialFecha: datos.saldoInicialFecha,
    conciliaciones: datos.conciliaciones,
    movimientos,
    hoy,
  });

  /*
   * Se guardan las listas, no solo las sumas.
   *
   * El panel tiene que poder contestar "¿de dónde sale este número?" con los
   * movimientos exactos que lo componen. Recalcularlos aparte, con el mismo
   * filtro escrito dos veces, es garantizar que un día el detalle no cuadre
   * con el total — y un detalle que no cuadra es peor que no tenerlo: el
   * usuario descubre que uno de los dos miente y no sabe cuál.
   *
   * Devolviendo el MISMO array que se reduce, no pueden separarse.
   */
  const aplicados = movimientos.filter((m) => m.fecha > estado.desde && m.fecha <= hoy);
  const entradas = aplicados.filter((m) => m.tipo === "ingreso");
  const salidas = aplicados.filter((m) => m.tipo === "gasto");

  const entraron = entradas.reduce((t, m) => t + m.monto, 0);
  const salieron = salidas.reduce((t, m) => t + m.monto, 0);

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

  /*
   * Lo que YA se pagó hace pocos días también cuenta como duplicado.
   *
   * Encontrado el 8 de septiembre de 2026 verificando el presupuesto contra
   * datos reales: se registró "pagué la cuota de Ueno" el día 8, y el
   * calendario la seguía mostrando como pendiente el 10, porque `anotados`
   * solo mira movimientos con fecha FUTURA.
   *
   * El efecto es el que este módulo justamente tiene prohibido causar: la
   * misma plata descontada dos veces —una como gasto hecho, otra como
   * compromiso por venir— y un disponible más bajo del real. A alguien
   * endeudado eso le dice que está peor de lo que está, que es la peor
   * mentira que puede decirle un panel de finanzas.
   *
   * La ventana de diez días cubre lo pagado con anticipación y lo pagado con
   * atraso: `sinDuplicar` después exige que coincidan importe (±10%) y fecha
   * (±3 días), así que un gasto cualquiera de la semana no tapa una cuota.
   */
  const desdeRecientes = sumarDias(hoy, -DIAS_DE_PAGOS_RECIENTES);
  const pagadosRecientes: MovimientoProyectado[] = movimientos
    .filter((m) => m.tipo === "gasto" && m.fecha >= desdeRecientes && m.fecha <= hoy)
    .map((m) => ({
      tipo: "gasto",
      descripcion: m.descripcion ?? "",
      monto: m.monto,
      fecha: m.fecha,
      periodicidad: "mensual",
      confianza: 1,
    }));

  // Las cuotas se agregan al final y filtradas: si el débito de la cuota
  // además viene detectado como serie, sumarla otra vez descontaría dos veces
  // la misma plata y produciría una alerta que no corresponde.
  /*
   * Las tarjetas entran junto con las cuotas y por el mismo filtro.
   *
   * Van en el bucket "cuota" y no en uno propio porque para quien lee son lo
   * mismo —plata pactada que sale en una fecha conocida— y la descripción ya
   * dice "Tarjeta — …". Un cuarto origen obligaría a tocar la trazabilidad y
   * las tres pantallas que la muestran, sin decirle nada nuevo a nadie.
   *
   * Lo que sí importa es que pasen por `sinDuplicar` CON las cuotas de deuda
   * en la lista de referencia: quien tenga la misma tarjeta cargada de las dos
   * formas la vería descontada dos veces todos los meses.
   */
  const deLasTarjetas = datos.obligacionesTarjeta ?? [];

  const cuotasDeDeuda = sinDuplicar(cuotasPendientes(deudas, { desde: hoy, hasta }), [
    ...previsibles,
    ...anotados,
    ...pagadosRecientes,
  ]);

  const cuotasDeTarjeta = sinDuplicar(deLasTarjetas, [
    ...previsibles,
    ...anotados,
    ...pagadosRecientes,
    ...cuotasDeDeuda,
  ]);

  const cuotas: EgresoPanorama[] = [...cuotasDeDeuda, ...cuotasDeTarjeta].map((c) => ({
    ...c,
    fuente: "cuota",
  }));

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
    aplicado: {
      ingresos: entraron,
      gastos: salieron,
      entradas,
      salidas,
      desde: estado.desde,
      hasta: hoy,
    },
  };
}
