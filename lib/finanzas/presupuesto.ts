/**
 * El presupuesto del mes, armado por EOS.
 *
 * ============================================================
 * LO QUE ESTE PRESUPUESTO NO ES
 * ============================================================
 *
 * No es una pantalla donde el usuario elige cuánto quiere gastar en veinticinco
 * categorías. Eso está descartado por la doctrina del producto con todas las
 * letras: es trabajo que EOS existe para no delegar, y además nadie lo
 * mantiene después de la primera semana.
 *
 * Acá el presupuesto se DEDUCE de lo que EOS ya sabe: lo que entra, lo que está
 * comprometido, cuánto quiso ahorrar la persona y cuánto gasta normalmente. El
 * usuario no completa nada.
 *
 * ============================================================
 * EL MARGEN NO SE INVENTA
 * ============================================================
 *
 * La tentación es poner "margen de seguridad: 10%". Ese diez sería un número
 * sacado del aire con apariencia de recomendación financiera.
 *
 * Acá el margen sale de la propia persona: es la diferencia entre lo que le
 * queda para el día a día y **lo que suele gastar**, medido con la mediana de
 * sus meses anteriores. Si le quedan 1.500.000 y normalmente gasta 1.200.000,
 * su margen es 300.000 — un dato, no una opinión.
 *
 * Sin historial no hay margen, y se dice. Un margen inventado es peor que
 * ninguno: alguien podría gastar hasta el límite creyendo que tiene un colchón
 * que nadie calculó.
 *
 * ============================================================
 * LA MEDIANA Y NO EL PROMEDIO
 * ============================================================
 *
 * Un mes con una compra grande —un pasaje, una reparación— arrastra el promedio
 * y hace que EOS crea que esa persona gasta más de lo que gasta. La mediana
 * describe el mes típico, que es lo que hace falta para saber si el mes que
 * viene entra.
 */

export type Obligacion = { descripcion: string; monto: number };

export type Presupuesto = {
  ingreso_esperado: number;
  obligaciones: number;
  detalle_obligaciones: Obligacion[];
  ahorro: number;
  /** Lo que queda para vivir, después de obligaciones y ahorro. */
  para_el_dia_a_dia: number;
  /** La mediana de gasto de los meses anteriores. `null` sin historial. */
  gasto_habitual: number | null;
  /** `para_el_dia_a_dia` menos lo que suele gastar. `null` sin historial. */
  margen: number | null;

  /* ---------- cómo viene el mes en curso ---------- */
  consumido: number;
  restante: number;
  dias_transcurridos: number;
  dias_restantes: number;
  /** Lo que viene gastando por día en este mes. */
  ritmo_diario: number;
  /** Dónde termina el mes si sigue a este ritmo. */
  proyeccion_cierre: number;
  /** Si la proyección entra en lo que hay. */
  alcanza: boolean;
  /** Qué tan confiable es todo esto, y por qué. */
  confianza: { nivel: number; motivos: string[] };
};

export function armarPresupuesto(opciones: {
  /** Día de hoy, en formato ISO. */
  hoy: string;
  /** Lo que EOS espera que entre este mes. */
  ingresoEsperado: number;
  /** Fijos y cuotas que vencen este mes. */
  obligaciones: Obligacion[];
  /** El porcentaje que la persona dijo querer ahorrar, de 0 a 100. */
  porcentajeAhorro: number;
  /** Gastos ya registrados en el mes en curso. Los negativos son devoluciones. */
  gastosDelMes: number[];
  /** Total gastado en cada mes anterior completo, del más viejo al más nuevo. */
  totalesPorMes: number[];
}): Presupuesto {
  const {
    hoy,
    ingresoEsperado,
    obligaciones,
    porcentajeAhorro,
    gastosDelMes,
    totalesPorMes,
  } = opciones;

  const totalObligaciones = redondear(obligaciones.reduce((t, o) => t + o.monto, 0));

  // El ahorro sale del ingreso, no de lo que sobra: si saliera de lo que sobra
  // nunca sobraría nada. Es la misma regla que usa el disponible real.
  const ahorro = redondear((ingresoEsperado * clamp(porcentajeAhorro, 0, 100)) / 100);

  const paraElDiaADia = redondear(ingresoEsperado - totalObligaciones - ahorro);

  const gastoHabitual = totalesPorMes.length > 0 ? redondear(mediana(totalesPorMes)) : null;
  const margen = gastoHabitual === null ? null : redondear(paraElDiaADia - gastoHabitual);

  // Las devoluciones vienen en negativo y restan solas, que es justamente para
  // lo que se guardan así.
  const consumido = redondear(gastosDelMes.reduce((t, g) => t + g, 0));

  const { transcurridos, restantes } = diasDelMes(hoy);

  // El ritmo del mes en curso. Se divide por los días transcurridos y no por
  // los del mes: el día 3 se lleva gastado lo de tres días, no lo de treinta.
  const ritmo = transcurridos > 0 ? redondear(consumido / transcurridos) : 0;
  const proyeccion = redondear(consumido + ritmo * restantes);

  const disponibleDelMes = redondear(ingresoEsperado - ahorro);
  const restante = redondear(disponibleDelMes - consumido);

  return {
    ingreso_esperado: redondear(ingresoEsperado),
    obligaciones: totalObligaciones,
    detalle_obligaciones: obligaciones,
    ahorro,
    para_el_dia_a_dia: paraElDiaADia,
    gasto_habitual: gastoHabitual,
    margen,
    consumido,
    restante,
    dias_transcurridos: transcurridos,
    dias_restantes: restantes,
    ritmo_diario: ritmo,
    proyeccion_cierre: proyeccion,
    alcanza: proyeccion <= disponibleDelMes,
    confianza: confianzaDe({ ingresoEsperado, obligaciones, totalesPorMes, transcurridos }),
  };
}

/**
 * Qué tan en serio hay que tomarse este presupuesto.
 *
 * Un presupuesto con ingreso desconocido, sin obligaciones cargadas y sin
 * historial es una cuenta sobre ceros. Decir el número igual, sin decir sobre
 * qué se apoya, es la clase de precisión falsa que este panel tiene prohibida.
 */
function confianzaDe(datos: {
  ingresoEsperado: number;
  obligaciones: Obligacion[];
  totalesPorMes: number[];
  transcurridos: number;
}): { nivel: number; motivos: string[] } {
  const motivos: string[] = [];
  let nivel = 1;

  if (datos.ingresoEsperado <= 0) {
    nivel -= 0.5;
    motivos.push("todavía no sé cuánto cobrás por mes");
  }

  if (datos.obligaciones.length === 0) {
    nivel -= 0.2;
    motivos.push("no tengo cargado ningún gasto fijo ni cuota");
  }

  if (datos.totalesPorMes.length === 0) {
    nivel -= 0.2;
    motivos.push("todavía no tengo un mes completo para saber cuánto gastás normalmente");
  } else if (datos.totalesPorMes.length === 1) {
    nivel -= 0.1;
    motivos.push("tengo un solo mes de historial, así que el hábito es provisorio");
  }

  // Los primeros días del mes el ritmo diario salta con cualquier compra: un
  // gasto de 300.000 el día 2 proyecta un cierre de 4.500.000 que no va a pasar.
  if (datos.transcurridos > 0 && datos.transcurridos < 5) {
    nivel -= 0.15;
    motivos.push("el mes recién empieza y la proyección se mueve mucho todavía");
  }

  return { nivel: Math.max(0, redondear(nivel)), motivos };
}

/** Días ya transcurridos del mes y los que quedan, contando hoy como vivido. */
export function diasDelMes(hoy: string): { transcurridos: number; restantes: number; total: number } {
  const [anio, mes, dia] = hoy.split("-").map(Number);

  // Día 0 del mes siguiente es el último del actual, sin tablas de meses ni
  // casos especiales para febrero bisiesto.
  const total = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const transcurridos = clamp(dia, 1, total);

  return { transcurridos, restantes: total - transcurridos, total };
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);

  return orden.length % 2 === 1 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(valor) ? valor : min));
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
