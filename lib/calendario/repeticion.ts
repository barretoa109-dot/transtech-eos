/**
 * Lo que se repite: "el 25 de cada mes", "todos los lunes".
 *
 * ============================================================
 * SE CALCULA AL LEER, NO SE GUARDA CADA VEZ
 * ============================================================
 *
 * Un evento que se repite es UNA fila con su regla (`repite`, `repite_hasta`), no
 * doce filas por año. Las ocurrencias se calculan para el rango que se mira.
 *
 * Guardarlas por adelantado obligaría a decidir cuántas y a mantenerlas: cambiar
 * la hora de los salarios sería tocar cuarenta filas, y el día que se acabaran
 * las generadas el evento dejaría de aparecer sin que nadie lo note. Calculadas
 * al leer, esa clase de falla no existe.
 *
 * ============================================================
 * EL DÍA 31 Y EL 29 DE FEBRERO
 * ============================================================
 *
 * Una regla mensual anclada al 31 cae el 28 en febrero y vuelve al 31 en marzo:
 * cada mes se calcula desde el día ORIGINAL, no desde la ocurrencia anterior. Si
 * se encadenara, febrero dejaría el evento pegado al 28 para siempre. Igual el 29
 * de febrero en los años que no son bisiestos.
 *
 * Todo con cadenas `YYYY-MM-DD` y aritmética en UTC, como el resto del calendario.
 */

export const REPETICIONES = ["diaria", "semanal", "mensual", "anual"] as const;

export type Repeticion = (typeof REPETICIONES)[number];

export const ETIQUETAS_REPITE: Record<Repeticion, string> = {
  diaria: "Todos los días",
  semanal: "Todas las semanas",
  mensual: "Todos los meses",
  anual: "Todos los años",
};

/** Lo que se le dice a la persona: "todos los meses", en minúscula y en medio de una frase. */
export const FRASE_REPITE: Record<Repeticion, string> = {
  diaria: "todos los días",
  semanal: "todas las semanas",
  mensual: "todos los meses",
  anual: "todos los años",
};

export function esRepeticion(valor: unknown): valor is Repeticion {
  return typeof valor === "string" && (REPETICIONES as readonly string[]).includes(valor);
}

/** Tope de ocurrencias por consulta: una regla diaria durante un año no debe inundar la pantalla. */
const TOPE = 400;

function partes(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

function aISO(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function ultimoDiaDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

export type Serie = {
  /** El día de la primera ocurrencia: de ahí sale el día del mes, de la semana o del año. */
  fecha: string;
  repite: Repeticion;
  /** Última fecha en que se repite, inclusive. Sin ella, no termina. */
  hasta: string | null;
};

/**
 * Los días, entre `desde` y `hasta` (inclusive), en que cae la serie. Ordenados.
 *
 * Nunca devuelve una fecha anterior a la primera ocurrencia ni posterior al fin
 * de la serie.
 */
export function ocurrencias(serie: Serie, desde: string, hasta: string): string[] {
  const limite = serie.hasta && serie.hasta < hasta ? serie.hasta : hasta;
  const inicio = desde > serie.fecha ? desde : serie.fecha;

  if (inicio > limite) return [];

  const dias: string[] = [];
  const ancla = partes(serie.fecha);

  if (serie.repite === "diaria" || serie.repite === "semanal") {
    const paso = serie.repite === "diaria" ? 1 : 7;
    // La primera ocurrencia que no es anterior a `inicio`.
    const saltos = Math.max(0, Math.ceil(diasEntre(serie.fecha, inicio) / paso));

    for (let k = saltos; dias.length < TOPE; k += 1) {
      const dia = new Date(Date.parse(`${serie.fecha}T00:00:00Z`) + k * paso * 86_400_000).toISOString().slice(0, 10);
      if (dia > limite) break;
      dias.push(dia);
    }

    return dias;
  }

  if (serie.repite === "mensual") {
    const desdeP = partes(inicio);
    let meses = (desdeP.y - ancla.y) * 12 + (desdeP.m - ancla.m);
    if (meses < 0) meses = 0;

    for (; dias.length < TOPE; meses += 1) {
      const total = ancla.m - 1 + meses;
      const y = ancla.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const dia = aISO(y, m, Math.min(ancla.d, ultimoDiaDelMes(y, m)));

      if (dia > limite) break;
      if (dia >= inicio) dias.push(dia);
    }

    return dias;
  }

  // anual
  const desdeP = partes(inicio);
  let anios = desdeP.y - ancla.y;
  if (anios < 0) anios = 0;

  for (; dias.length < TOPE; anios += 1) {
    const y = ancla.y + anios;
    const dia = aISO(y, ancla.m, Math.min(ancla.d, ultimoDiaDelMes(y, ancla.m)));

    if (dia > limite) break;
    if (dia >= inicio) dias.push(dia);
  }

  return dias;
}
