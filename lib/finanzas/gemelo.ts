import { trazarTrayectoria, type Trayectoria } from "./trayectoria.ts";
import type { MovimientoProyectado } from "./recurrencia.ts";

/**
 * El gemelo digital financiero: comparar la curva de saldo ACTUAL contra una
 * HIPOTÉTICA con un cambio adentro —una cuota nueva, una suscripción que se
 * da de baja— y ver cómo se mueve en el tiempo.
 *
 * Es el ítem 16 del documento EOS 2030 ("Financial Digital Twin: simular el
 * futuro económico de una persona o empresa"), apoyado en dos piezas que ya
 * existían: `trazarTrayectoria` (la curva día por día) y `escenarios.ts` (el
 * "¿puedo comprar esto?" de un solo momento, con sus consecuencias). Lo que
 * faltaba era el mismo tipo de pregunta pero ESTIRADA EN EL TIEMPO: no
 * "¿puedo pagar esta cuota hoy?" sino "¿cómo se ve mi plata las próximas
 * semanas si la tomo?".
 *
 * ============================================================
 * SOLO SE SIMULA LO QUE LA PERSONA YA PROPUSO, NUNCA SE INVENTA UN AHORRO
 * ============================================================
 *
 * "¿Qué pasa si ahorro más?" no tiene nada que comparar acá: ahorrar no es
 * gastar menos de lo que la trayectoria ya proyecta, es una decisión sobre
 * plata que ya cuenta como disponible — eso ya lo contesta `objetivos.ts`
 * (cuándo llegarías a una meta a un ritmo distinto). Lo que SÍ mueve esta
 * curva es un compromiso nuevo (una cuota que antes no existía) o uno que
 * desaparece (una baja) — con el monto y la fecha que la persona misma dio,
 * nunca un número que EOS adivina.
 *
 * La hipotética recibe sus propias listas de egresos e ingresos, completas —el
 * mismo estilo que ya usa `trazarBanda` para piso y techo—, nunca una delta
 * que este módulo le suma a la actual. Para una cuota nueva, la hipotética es
 * la lista actual más las ocurrencias de la cuota; para una baja, es la lista
 * actual SIN las ocurrencias futuras de ese gasto. Armarlo como una resta
 * automática (agregar un ingreso que cancele el egreso) rompería la regla de
 * `trazarTrayectoria` de que dentro de un mismo día los egresos van primero:
 * el "ingreso que cancela" llegaría tarde para evitar el piso que ese mismo
 * día ya perforó la reserva.
 */

export type Gemelo = {
  actual: Trayectoria;
  hipotetica: Trayectoria;
  /** Cuánto cambia el saldo al cierre del horizonte. Negativo si empeora. */
  diferencia_al_cierre: number;
  /** El cambio hace que la curva perfore la reserva cuando antes no lo hacía. */
  empeora_el_riesgo: boolean;
  /** El cambio evita que la curva perfore la reserva. */
  mejora_el_riesgo: boolean;
};

export function compararTrayectorias(opciones: {
  hoy: string;
  hasta: string;
  saldoActual: number;
  reservaMinima: number;
  egresos: MovimientoProyectado[];
  ingresos: MovimientoProyectado[];
  /** La lista completa de egresos en el escenario hipotético. */
  egresosHipotetica: MovimientoProyectado[];
  /** La lista completa de ingresos en el escenario hipotético. */
  ingresosHipotetica: MovimientoProyectado[];
}): Gemelo {
  const base = {
    hoy: opciones.hoy,
    hasta: opciones.hasta,
    saldoActual: opciones.saldoActual,
    reservaMinima: opciones.reservaMinima,
  };

  const actual = trazarTrayectoria({ ...base, egresos: opciones.egresos, ingresos: opciones.ingresos });

  const hipotetica = trazarTrayectoria({
    ...base,
    egresos: opciones.egresosHipotetica,
    ingresos: opciones.ingresosHipotetica,
  });

  const cierre = (t: Trayectoria) => t.puntos[t.puntos.length - 1]?.saldo ?? opciones.saldoActual;

  return {
    actual,
    hipotetica,
    diferencia_al_cierre: redondear(cierre(hipotetica) - cierre(actual)),
    empeora_el_riesgo: actual.cruce === null && hipotetica.cruce !== null,
    mejora_el_riesgo: actual.cruce !== null && hipotetica.cruce === null,
  };
}

/**
 * Las ocurrencias mensuales de un movimiento hipotético, dentro del
 * horizonte. Una cuota nueva no cae una sola vez: cae cada mes, y la curva
 * tiene que mostrar las dos o tres veces que entra en los próximos 45 días.
 *
 * Confianza 1 a propósito: es un compromiso que la persona misma está
 * proponiendo, no un patrón que EOS detectó y del que podría dudar.
 */
export function ocurrenciasMensuales(opciones: {
  tipo: MovimientoProyectado["tipo"];
  descripcion: string;
  monto: number;
  /** El día del mes en que cae, 1 a 31. Si el mes no llega a ese día, el último. */
  diaDelMes: number;
  desde: string;
  hasta: string;
}): MovimientoProyectado[] {
  const { tipo, descripcion, monto, diaDelMes, desde, hasta } = opciones;
  if (monto <= 0 || desde > hasta) return [];

  const ocurrencias: MovimientoProyectado[] = [];
  const [anioInicio, mesInicio] = desde.split("-").map(Number);

  let cursor = primerDiaValido(anioInicio, mesInicio, diaDelMes);
  if (cursor < desde) cursor = primerDiaValido(anioInicio, mesInicio + 1, diaDelMes);

  let guardia = 0;
  while (cursor <= hasta && guardia < 60) {
    ocurrencias.push({ tipo, descripcion, monto, fecha: cursor, periodicidad: "mensual", confianza: 1 });

    const [anio, mes] = cursor.split("-").map(Number);
    cursor = primerDiaValido(anio, mes + 1, diaDelMes);
    guardia += 1;
  }

  return ocurrencias;
}

/** El día pedido del mes, o el último si ese mes no llega tan lejos (31 de febrero → 28 o 29). */
function primerDiaValido(anio: number, mes: number, dia: number): string {
  const ultimoDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const diaReal = Math.min(Math.max(1, Math.round(dia)), ultimoDelMes);
  return new Date(Date.UTC(anio, mes - 1, diaReal)).toISOString().slice(0, 10);
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
