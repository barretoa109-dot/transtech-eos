/**
 * Un objetivo financiero, convertido en plata por mes.
 *
 * ============================================================
 * QUÉ CAMBIA RESPECTO DE LO QUE HABÍA
 * ============================================================
 *
 * `eos_goals` guarda objetivos desde hace meses, y el panel personal leía de
 * ahí exactamente dos columnas: `estado` y `progreso`. Con eso armaba un
 * booleano —`objetivos_en_ritmo`— que daba verdadero siempre que el progreso
 * fuera mayor que cero. Alguien con un objetivo al 3% cuando le quedaba un mes
 * veía "en ritmo".
 *
 * "Quiero tener 30.000.000 para diciembre" no es una barra de progreso. Es una
 * cuenta: cuánto falta, en cuántos aportes, cuánto hay que apartar por mes, y
 * si eso entra en el ahorro que la persona ya comprometió.
 *
 * ============================================================
 * EL RITMO SE MIDE CONTRA EL ESFUERZO ORIGINAL, NO CONTRA UN PORCENTAJE
 * ============================================================
 *
 * La forma fácil de decir "vas atrasado" es comparar el progreso contra el
 * tiempo transcurrido: 40% del plazo consumido y 30% del monto ahorrado, luego
 * atrasado. El problema es que al segundo día del plan cualquiera está
 * "atrasado" por milésimas, y hace falta inventar una tolerancia —¿5%? ¿10%?—
 * que no sale de ningún lado.
 *
 * Acá se compara el aporte que hace falta AHORA contra el que hacía falta
 * cuando el objetivo se definió. Si subió, se quedó atrás; si no, va bien. No
 * necesita tolerancia, es exacto, y sobre todo se puede decir en una frase que
 * significa algo: "para llegar necesitás apartar 2.100.000 por mes; cuando lo
 * definiste alcanzaba con 1.800.000".
 *
 * ============================================================
 * LOS APORTES SE CUENTAN, NO SE ESTIMAN
 * ============================================================
 *
 * Del 8 de septiembre al 31 de diciembre no hay "3,8 meses": hay cuatro
 * aportes —septiembre, octubre, noviembre y diciembre— porque la gente aparta
 * plata una vez por mes, no en fracciones. Dividir por 3,8 da un número que no
 * corresponde a ningún mes real.
 *
 * ============================================================
 * QUÉ NO HACE
 * ============================================================
 *
 * No inventa el monto actual. Si la persona no lo declaró y el objetivo no
 * está atado a una cuenta, `actual` es cero y `confianza` lo dice — no se
 * deduce del saldo total, porque tener 30 millones en la cuenta no significa
 * que estén destinados a este objetivo.
 *
 * Es puro: recibe filas ya leídas y no toca la base.
 */

/** Días de un mes promedio, para pasar un ritmo diario a mensual. */
const DIAS_POR_MES = 30.4375;

/**
 * Cuánto tiene que existir un objetivo antes de que se pueda medir su ritmo
 * real. Menos de un mes es un solo dato, y un solo dato no es una tendencia.
 */
const DIAS_MINIMOS_PARA_MEDIR_RITMO = 30;

/**
 * A partir de cuándo el monto declarado empieza a envejecer.
 *
 * Mes y medio: alguien que declara su ahorro una vez por mes queda dentro, y
 * quien lo declaró en marzo y estamos en agosto, no.
 */
const DIAS_HASTA_QUE_EL_MONTO_ENVEJECE = 45;

export type ObjetivoFinanciero = {
  id: string;
  titulo: string;
  clase: "general" | "fondo_emergencia";
  moneda: string;
  /** 1 es lo más importante, 5 lo menos. */
  prioridad: number;
  /** Cuánto quiere llegar a tener. */
  objetivo: number;
  /** Cuánto tenía cuando lo definió. */
  inicial: number;
  /** Cuánto tiene hoy destinado a esto. */
  actual: number;
  /**
   * De dónde salió `actual`.
   *
   * `cuenta` es el saldo declarado de la cuenta a la que está atado el
   * objetivo; `declarado`, un número que la persona dio para este objetivo.
   * Los dos son datos declarados —EOS no ve saldos bancarios—, pero el
   * primero se mantiene solo cada vez que actualiza sus cuentas.
   */
  origen: "cuenta" | "declarado";
  /** Cuándo se actualizó `actual` por última vez. */
  actual_al: string | null;
  /** Cuándo empezó. */
  desde: string;
  /** Para cuándo lo quiere. `null` si no puso fecha. */
  hasta: string | null;
};

export type EstadoObjetivo = {
  id: string;
  titulo: string;
  clase: ObjetivoFinanciero["clase"];
  moneda: string;
  prioridad: number;

  objetivo: number;
  actual: number;
  origen: ObjetivoFinanciero["origen"];
  actual_al: string | null;
  /** Lo que falta para llegar. Nunca negativo. */
  falta: number;
  /** De 0 a 100, sobre la meta y no sobre el tramo pendiente. */
  progreso: number;

  hasta: string | null;
  dias_restantes: number | null;
  /** Cuántas veces más va a poder apartar plata antes de la fecha. */
  aportes_restantes: number | null;
  /** Cuánto tendría que apartar en cada uno de esos aportes. */
  aporte_necesario: number | null;
  /** Cuánto hacía falta apartar cuando definió el objetivo. */
  aporte_original: number | null;
  /** Lo que viene apartando de verdad, por mes. `null` si es muy pronto. */
  aporte_real: number | null;
  /** `aporte_real` menos `aporte_necesario`. Negativo es faltante. */
  desvio: number | null;
  /** Cuándo llegaría si sigue al ritmo actual. `null` si no avanza. */
  llegada_estimada: string | null;

  estado: "cumplido" | "vencido" | "en_ritmo" | "atrasado" | "sin_fecha";
  confianza: { nivel: number; motivos: string[] };
};

export function evaluarObjetivo(o: ObjetivoFinanciero, hoy: string): EstadoObjetivo {
  const objetivo = Math.max(0, o.objetivo);
  const actual = Math.max(0, o.actual);
  const inicial = Math.max(0, Math.min(o.inicial, objetivo));

  const falta = redondear(Math.max(0, objetivo - actual));
  const progreso = objetivo > 0 ? Math.min(100, redondear((actual / objetivo) * 100)) : 0;

  const cumplido = objetivo > 0 && actual >= objetivo;
  const vencido = !cumplido && o.hasta !== null && o.hasta < hoy;

  const diasRestantes = o.hasta === null ? null : diasEntre(hoy, o.hasta);
  const aportesRestantes = o.hasta === null ? null : Math.max(0, aportesEntre(hoy, o.hasta));

  /*
   * Con cero aportes restantes el faltante no se divide: se debe entero hoy.
   * Dividir por cero daría infinito y la pantalla mostraría un símbolo en vez
   * de la plata que hay que poner.
   */
  const aporteNecesario =
    aportesRestantes === null || cumplido
      ? null
      : aportesRestantes === 0
        ? falta
        : redondear(falta / aportesRestantes);

  const aportesTotales = o.hasta === null ? null : Math.max(1, aportesEntre(o.desde, o.hasta));
  const aporteOriginal =
    aportesTotales === null ? null : redondear(Math.max(0, objetivo - inicial) / aportesTotales);

  /*
   * El ritmo real necesita historia. Con menos de un mes de vida hay un solo
   * dato, y un solo dato dividido por el tiempo da un número que se mueve
   * enormemente de un día para el otro.
   */
  const diasDeVida = diasEntre(o.desde, hoy);
  const aporteReal =
    diasDeVida < DIAS_MINIMOS_PARA_MEDIR_RITMO
      ? null
      : redondear((actual - inicial) / (diasDeVida / DIAS_POR_MES));

  const desvio =
    aporteReal === null || aporteNecesario === null ? null : redondear(aporteReal - aporteNecesario);

  const llegada =
    aporteReal !== null && aporteReal > 0 && falta > 0
      ? sumarMeses(hoy, Math.ceil(falta / aporteReal))
      : null;

  const estado: EstadoObjetivo["estado"] = cumplido
    ? "cumplido"
    : vencido
      ? "vencido"
      : o.hasta === null
        ? "sin_fecha"
        : aporteNecesario !== null && aporteOriginal !== null && aporteNecesario > aporteOriginal
          ? "atrasado"
          : "en_ritmo";

  return {
    id: o.id,
    titulo: o.titulo,
    clase: o.clase,
    moneda: o.moneda,
    prioridad: o.prioridad,
    objetivo: redondear(objetivo),
    actual: redondear(actual),
    origen: o.origen,
    actual_al: o.actual_al,
    falta,
    progreso,
    hasta: o.hasta,
    dias_restantes: diasRestantes,
    aportes_restantes: aportesRestantes,
    aporte_necesario: aporteNecesario,
    aporte_original: aporteOriginal,
    aporte_real: aporteReal,
    desvio,
    llegada_estimada: llegada,
    estado,
    confianza: confianzaDe(o, hoy, cumplido),
  };
}

/**
 * Qué tan en serio hay que tomarse estos números.
 *
 * Un objetivo sin fecha y con un monto declarado hace cinco meses produce una
 * cuenta impecable sobre datos viejos. El número se muestra igual —esconderlo
 * no lo mejora— pero con lo que le falta escrito al lado.
 */
function confianzaDe(
  o: ObjetivoFinanciero,
  hoy: string,
  cumplido: boolean,
): { nivel: number; motivos: string[] } {
  const motivos: string[] = [];
  let nivel = 1;

  if (o.hasta === null) {
    nivel -= 0.3;
    motivos.push("no me dijiste para cuándo lo querés, así que no puedo decirte cuánto apartar por mes");
  }

  if (!cumplido && o.actual_al !== null && diasEntre(o.actual_al, hoy) > DIAS_HASTA_QUE_EL_MONTO_ENVEJECE) {
    nivel -= 0.3;
    motivos.push(`el monto que tengo guardado es del ${o.actual_al}`);
  }

  if (o.actual === 0 && !cumplido) {
    nivel -= 0.2;
    motivos.push("todavía no sé cuánto llevás juntado");
  }

  if (o.origen === "declarado" && o.actual > 0) {
    nivel -= 0.1;
    motivos.push("el monto lo declaraste vos; si lo atás a una cuenta lo actualizo solo");
  }

  return { nivel: Math.max(0, redondear(nivel)), motivos };
}

export type ContrasteConElAhorro = {
  moneda: string;
  /** La suma de lo que hay que apartar por mes para todos los objetivos. */
  aporte_necesario_total: number;
  /** Lo que la persona ya aparta según su Constitución Financiera. */
  ahorro_mensual: number;
  alcanza: boolean;
  /** Cuánto más por mes haría falta. Cero cuando alcanza. */
  faltante: number;
  /** Los objetivos que no entran, del menos importante al más. */
  no_entran: { id: string; titulo: string; aporte_necesario: number }[];
};

/**
 * Si el ahorro que la persona ya comprometió alcanza para sus objetivos.
 *
 * ============================================================
 * POR QUÉ ESTO NO SE RESTA DEL DISPONIBLE REAL
 * ============================================================
 *
 * El disponible real ya descuenta el ahorro comprometido: es el
 * `porcentaje_ahorro` de la Constitución Financiera. Descontar ADEMÁS el
 * aporte de cada objetivo sería contar la misma plata dos veces y dejar a la
 * persona con un disponible falsamente bajo — el mismo error que este proyecto
 * ya cometió con una cuota pagada.
 *
 * Los objetivos no compiten con el disponible: compiten CON EL AHORRO. Por eso
 * lo que hace falta es un contraste, no una resta.
 *
 * ============================================================
 * QUÉ QUEDA AFUERA CUANDO NO ALCANZA
 * ============================================================
 *
 * Se ordena por prioridad —la que la persona ya declaró en cada objetivo— y se
 * van marcando los que no entran empezando por el menos importante. EOS no
 * elige por ella: le muestra qué es lo que no cabe.
 */
export function contrastarConElAhorro(
  estados: EstadoObjetivo[],
  ahorroMensual: number,
  moneda: string,
): ContrasteConElAhorro {
  const conAporte = estados
    .filter((e) => e.moneda === moneda && e.aporte_necesario !== null && e.aporte_necesario > 0)
    .filter((e) => e.estado !== "cumplido");

  const total = redondear(conAporte.reduce((t, e) => t + (e.aporte_necesario ?? 0), 0));
  const ahorro = redondear(Math.max(0, ahorroMensual));
  const alcanza = total <= ahorro;

  const noEntran: ContrasteConElAhorro["no_entran"] = [];

  if (!alcanza) {
    // Del menos importante al más: prioridad 5 es la que se cae primero. A
    // igualdad de prioridad, el aporte más chico queda —sacar el grande libera
    // más y deja más objetivos vivos.
    const porSacrificar = [...conAporte].sort(
      (a, b) => b.prioridad - a.prioridad || (b.aporte_necesario ?? 0) - (a.aporte_necesario ?? 0),
    );

    let acumulado = total;
    for (const e of porSacrificar) {
      if (acumulado <= ahorro) break;
      noEntran.push({ id: e.id, titulo: e.titulo, aporte_necesario: e.aporte_necesario ?? 0 });
      acumulado = redondear(acumulado - (e.aporte_necesario ?? 0));
    }
  }

  return {
    moneda,
    aporte_necesario_total: total,
    ahorro_mensual: ahorro,
    alcanza,
    faltante: alcanza ? 0 : redondear(total - ahorro),
    no_entran: noEntran,
  };
}

/**
 * Cuántas veces más va a poder apartar plata entre las dos fechas.
 *
 * Cuenta meses de calendario, con los dos extremos adentro: del 8 de
 * septiembre al 31 de diciembre son CUATRO —septiembre, octubre, noviembre y
 * diciembre—, no 3,8. La gente aparta plata una vez por mes, y un aporte de
 * 0,8 de mes no existe.
 */
export function aportesEntre(desde: string, hasta: string): number {
  const [a1, m1] = desde.split("-").map(Number);
  const [a2, m2] = hasta.split("-").map(Number);

  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((enUTC(hasta) - enUTC(desde)) / 86_400_000);
}

/**
 * El mediodía UTC de una fecha ISO.
 *
 * El mes va menos uno porque `Date.UTC` los cuenta desde cero. Dejarlo corrido
 * "en las dos fechas por igual" no se compensa: enero tiene 31 días y febrero
 * 28, así que del 31 de enero al 28 de febrero saldrían 25 días en vez de 28.
 */
function enUTC(iso: string): number {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return Date.UTC(anio, mes - 1, dia);
}

/** El mismo día, `meses` meses después. Si ese día no existe, el último del mes. */
function sumarMeses(iso: string, meses: number): string {
  const [anio, mes, dia] = iso.split("-").map(Number);
  const ultimoDelDestino = new Date(Date.UTC(anio, mes - 1 + meses + 1, 0)).getUTCDate();
  const fecha = new Date(Date.UTC(anio, mes - 1 + meses, Math.min(dia, ultimoDelDestino)));

  return fecha.toISOString().slice(0, 10);
}

function redondear(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0;
}
