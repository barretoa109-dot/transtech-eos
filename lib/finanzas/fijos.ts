import { normalizarDescripcion, type SerieRecurrente } from "./recurrencia.ts";

/**
 * Ingresos y gastos fijos declarados por el usuario.
 *
 * El detector de recurrencia necesita ver un movimiento DOS VECES para
 * reconocerlo. Para el alquiler eso son dos meses: hasta entonces el panel no
 * sabe nada y no le sirve a nadie.
 *
 * La salida es que el usuario lo diga una vez al configurarse. Eso no rompe la
 * doctrina: ya declara su Constitución Financiera una vez, y esto es la misma
 * categoría —configuración inicial, no carga diaria—. Lo que sigue prohibido es
 * que cargue cada gasto del supermercado.
 *
 * La regla que hace que esto no se vuelva un problema: **lo declarado es una
 * semilla, no una verdad congelada.** En cuanto el correo empieza a traer el
 * alquiler real, la serie detectada REEMPLAZA a la declarada. Si se sumaran,
 * el usuario vería el alquiler descontado dos veces.
 */

export type Fijo = {
  tipo: "ingreso" | "gasto";
  descripcion: string;
  monto: number;
  /** Día del mes en que ocurre. 1-31; se ajusta si el mes es más corto. */
  dia_del_mes: number;
};

/** Confianza de lo declarado.
 *
 * Por encima del umbral de proyección (0,6) para que cuente desde el día uno,
 * pero por debajo de lo observado: si algún día hay que elegir entre lo que el
 * usuario dijo y lo que realmente pasó, gana lo que pasó.
 */
const CONFIANZA_DECLARADA = 0.7;

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Próxima vez que cae ese día del mes, a partir de `desde` inclusive.
 *
 * Si el mes no tiene ese día —el 31 en febrero— se ancla al último día, que
 * es como funciona cualquier débito automático.
 */
export function proximaFechaDelMes(dia: number, desde: string): string {
  const [anio, mes, diaActual] = desde.slice(0, 10).split("-").map(Number);

  const enMes = (a: number, m: number) => {
    const tope = ultimoDiaDelMes(a, m);
    return Math.min(Math.max(1, Math.round(dia)), tope);
  };

  // ¿Todavía no pasó este mes?
  if (enMes(anio, mes) >= diaActual) {
    return `${anio}-${String(mes).padStart(2, "0")}-${String(enMes(anio, mes)).padStart(2, "0")}`;
  }

  const mesSiguiente = mes === 12 ? 1 : mes + 1;
  const anioSiguiente = mes === 12 ? anio + 1 : anio;

  return `${anioSiguiente}-${String(mesSiguiente).padStart(2, "0")}-${String(
    enMes(anioSiguiente, mesSiguiente),
  ).padStart(2, "0")}`;
}

/** Convierte una declaración en una serie que el proyector entiende. */
function comoSerie(fijo: Fijo, hoy: string): SerieRecurrente {
  const nombre = normalizarDescripcion(fijo.descripcion);
  const proxima = proximaFechaDelMes(fijo.dia_del_mes, hoy);

  return {
    clave: `declarado::${fijo.tipo}::${nombre}`,
    tipo: fijo.tipo,
    descripcion: fijo.descripcion.trim(),
    monto: fijo.monto,
    periodicidad: "mensual",
    // Cero: nunca se observó. Es una declaración, no un historial.
    ocurrencias: 0,
    ultima_fecha: hoy,
    proxima_fecha: proxima,
    confianza: CONFIANZA_DECLARADA,
  };
}

/**
 * Une lo declarado con lo detectado, sin duplicar.
 *
 * Cuando el mismo concepto aparece en ambos lados gana el DETECTADO: son los
 * movimientos que realmente ocurrieron, con el importe real. La declaración
 * cumplió su función —sostener el panel los primeros meses— y se retira sola,
 * sin que el usuario tenga que ir a borrarla.
 */
export function combinarSeries(
  detectadas: SerieRecurrente[],
  fijos: Fijo[],
  hoy: string,
): SerieRecurrente[] {
  const observadas = new Set(
    detectadas.map((s) => `${s.tipo}::${normalizarDescripcion(s.descripcion)}`),
  );

  const declaradas = fijos
    .filter((f) => Number.isFinite(f.monto) && f.monto > 0)
    .map((f) => comoSerie(f, hoy))
    .filter((s) => !observadas.has(`${s.tipo}::${normalizarDescripcion(s.descripcion)}`));

  return [...detectadas, ...declaradas].sort((a, b) =>
    a.proxima_fecha.localeCompare(b.proxima_fecha),
  );
}

/** Cuántas declaraciones ya fueron reemplazadas por movimientos reales. */
export function confirmadosPorLaRealidad(
  detectadas: SerieRecurrente[],
  fijos: Fijo[],
): number {
  const observadas = new Set(
    detectadas.map((s) => `${s.tipo}::${normalizarDescripcion(s.descripcion)}`),
  );

  return fijos.filter((f) =>
    observadas.has(`${f.tipo}::${normalizarDescripcion(f.descripcion)}`),
  ).length;
}
