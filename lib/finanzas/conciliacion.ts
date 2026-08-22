/**
 * Conciliación: que EOS sepa lo que no sabe, sin devolverle el problema al usuario.
 *
 * EOS ve los movimientos que llegan por correo, documentos o chat. No ve los
 * pagos con billetera, el efectivo, ni nada que no deje rastro digital. Sin
 * corregirlo, `disponible_real` muestra un número con total confianza estando
 * equivocado — y el usuario decide con él. Eso es peor que no mostrar nada.
 *
 * La solución NO es pedirle al usuario que cargue lo que falta. Eso lo
 * convierte en el empleado de EOS, que es exactamente lo que la doctrina
 * rechaza. La solución es que diga UN número —cuánto tiene de verdad— y que
 * EOS haga el resto:
 *
 *   1ª vez  → EOS corrige la base y ya no miente.
 *   2ª vez  → EOS calcula a qué ritmo se le escapa dinero.
 *   de ahí  → EOS descuenta solo ese gasto invisible y deja de preguntar.
 *
 * Ese tercer paso es el objetivo. Preguntar dos veces para no preguntar nunca
 * más. El usuario deja de preocuparse porque EOS aprendió su ritmo, no porque
 * le pasamos la carga.
 *
 * Puro, sin I/O, como el resto de `lib/finanzas`: acá se decide cuánta plata
 * cree el usuario que tiene.
 */

export type Movimiento = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  fecha: string; // ISO YYYY-MM-DD
};

export type Conciliacion = {
  fecha: string; // ISO YYYY-MM-DD
  saldo_declarado: number;
};

export type Confianza = "alta" | "media" | "baja";

export type ResultadoConciliacion = {
  /** Saldo del que partir: el último declarado, o el inicial si nunca hubo. */
  base: number;
  /** Fecha desde la que se aplican los movimientos. */
  desde: string;
  /**
   * Lo que EOS estima que se gastó sin verlo, desde la última conciliación.
   * Siempre >= 0: si sobra dinero es que falta registrar un ingreso, y eso
   * no se suma nunca — no se gasta plata que no se sabe si entró.
   */
  gasto_invisible: number;
  /** Guaraníes por día que se le escapan, si ya se pudo calcular. */
  ritmo_diario: number | null;
  confianza: Confianza;
  /** Cuántas veces el usuario le dijo a EOS su saldo real. */
  conciliaciones: number;
  /** Días desde la última. */
  dias_desde_ultima: number | null;
};

const DIA_MS = 86_400_000;

/**
 * Tope del ritmo diario invisible.
 *
 * Una conciliación rara —el usuario miró la cuenta equivocada, o transfirió
 * plata a un plazo fijo— produciría un ritmo enorme que se proyectaría para
 * siempre y le mostraría al usuario mucho menos dinero del que tiene. Preferimos
 * subestimar el gasto invisible: quedarse corto genera una sorpresa
 * desagradable una vez; pasarse genera desconfianza permanente en el número.
 */
const MAX_RITMO_DIARIO = 2_000_000;

function aFecha(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getTime();
}

function diasEntre(desde: string, hasta: string): number {
  return Math.max(0, Math.round((aFecha(hasta) - aFecha(desde)) / DIA_MS));
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

/** Suma neta de los movimientos aplicados en un tramo (ingresos menos gastos). */
function netoEntre(movimientos: Movimiento[], desde: string, hasta: string): number {
  return movimientos
    .filter((m) => m.tipo !== "compromiso" && m.fecha > desde && m.fecha <= hasta)
    .reduce((total, m) => total + (m.tipo === "ingreso" ? m.monto : -m.monto), 0);
}

/**
 * Calcula el ritmo al que se le escapa dinero a EOS.
 *
 * Para cada par de conciliaciones consecutivas: lo que EOS habría calculado
 * al llegar a la segunda, contra lo que el usuario dijo que tenía realmente.
 * La diferencia es lo que ocurrió sin que EOS lo viera.
 *
 * Se usa la mediana y no el promedio: un mes atípico —una compra grande en
 * efectivo, un viaje— no debe torcer la estimación de todos los meses.
 */
export function calcularRitmo(
  conciliaciones: Conciliacion[],
  movimientos: Movimiento[],
): number | null {
  const orden = [...conciliaciones].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (orden.length < 2) return null;

  const ritmos: number[] = [];

  for (let i = 1; i < orden.length; i += 1) {
    const anterior = orden[i - 1];
    const actual = orden[i];
    const dias = diasEntre(anterior.fecha, actual.fecha);

    // Dos conciliaciones el mismo día no dicen nada sobre un ritmo.
    if (dias < 1) continue;

    const esperado = anterior.saldo_declarado + netoEntre(movimientos, anterior.fecha, actual.fecha);
    const brecha = esperado - actual.saldo_declarado;

    // Brecha negativa = el usuario tiene MÁS de lo que EOS calculaba, o sea
    // que falta registrar un ingreso. No es gasto invisible: se ignora, para
    // no inflar artificialmente el disponible.
    ritmos.push(Math.max(0, brecha) / dias);
  }

  if (ritmos.length === 0) return null;

  return Math.min(mediana(ritmos), MAX_RITMO_DIARIO);
}

/**
 * Estado de conciliación de un usuario.
 *
 * `hoy` se recibe en vez de leerse del reloj para que el cálculo sea
 * reproducible y testeable.
 */
export function conciliar(opciones: {
  saldoInicial: number;
  saldoInicialFecha: string;
  conciliaciones: Conciliacion[];
  movimientos: Movimiento[];
  hoy: string;
}): ResultadoConciliacion {
  const { saldoInicial, saldoInicialFecha, movimientos, hoy } = opciones;

  const orden = [...opciones.conciliaciones].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultima = orden[orden.length - 1] ?? null;

  // Nunca conciliado: se opera como hasta ahora, pero declarando confianza
  // baja para que la interfaz pueda ser honesta sin alarmar.
  if (!ultima) {
    return {
      base: saldoInicial,
      desde: saldoInicialFecha,
      gasto_invisible: 0,
      ritmo_diario: null,
      confianza: movimientos.length === 0 ? "baja" : "media",
      conciliaciones: 0,
      dias_desde_ultima: null,
    };
  }

  const dias = diasEntre(ultima.fecha, hoy);
  const ritmo = calcularRitmo(orden, movimientos);

  // Con un solo dato no hay ritmo todavía: la base ya es correcta, así que no
  // se inventa ningún descuento. EOS no miente, solo todavía no aprendió.
  const gastoInvisible = ritmo === null ? 0 : Math.round(ritmo * dias);

  // La confianza cae con el tiempo: un saldo declarado hace dos meses ya no
  // dice mucho, aunque el ritmo ayude.
  let confianza: Confianza;
  if (ritmo !== null && dias <= 45) confianza = "alta";
  else if (dias <= 30) confianza = "media";
  else confianza = "baja";

  return {
    base: ultima.saldo_declarado,
    desde: ultima.fecha,
    gasto_invisible: gastoInvisible,
    ritmo_diario: ritmo,
    confianza,
    conciliaciones: orden.length,
    dias_desde_ultima: dias,
  };
}

/**
 * ¿Conviene pedirle al usuario que confirme su saldo?
 *
 * Esta función existe para que EOS pregunte lo MÍNIMO. La filosofía es que el
 * usuario deje de preocuparse, así que cada pregunta hay que justificarla:
 *
 *  - Sin ninguna conciliación y con movimientos ya cargados: vale preguntar
 *    una vez, porque sin eso el número que muestra puede estar mal.
 *  - Con una sola: vale preguntar de nuevo, porque la segunda es la que le
 *    permite aprender el ritmo y no volver a molestar.
 *  - Con ritmo aprendido: NO se pregunta salvo que haya pasado mucho tiempo.
 *    Este es el estado al que queremos llegar y en el que hay que quedarse.
 */
export function convieneConciliar(estado: ResultadoConciliacion): boolean {
  if (estado.conciliaciones === 0) return true;
  if (estado.ritmo_diario === null) return (estado.dias_desde_ultima ?? 0) >= 7;

  // Ya aprendió: solo se vuelve a preguntar cuando el dato quedó viejo.
  return (estado.dias_desde_ultima ?? 0) >= 60;
}
