/**
 * Proyectar un indicador hacia adelante a partir de su propia historia.
 *
 * ============================================================
 * ACÁ SÍ SE ESTIMA, Y POR ESO HAY MÁS CANDADOS QUE EN CAJA
 * ============================================================
 *
 * `caja.ts` proyecta lo que ya está pactado: no adivina. Esto es lo otro —una
 * recta ajustada sobre la serie histórica— y una recta puede decir cualquier
 * cosa si nadie la controla. Los cuatro candados:
 *
 *   1. MÍNIMO DE PUNTOS. Con menos de dos semanas no se proyecta. Una recta
 *      sobre cuatro días es ruido con pendiente.
 *
 *   2. EL AJUSTE VIAJA CON EL NÚMERO. R² dice cuánto de la variación explica
 *      la recta. Si es bajo, la serie no tiene forma de recta y proyectarla es
 *      inventar. Se devuelve `no_se_puede` en vez de un número.
 *
 *   3. NUNCA UN PUNTO SOLO. Siempre un intervalo. Un pronóstico sin banda se
 *      lee como una promesa, y no lo es.
 *
 *   4. LOS HUECOS NO SE RELLENAN. Un día sin dato no se interpola: se saltea.
 *      Inventar el punto del medio para que la serie quede prolija es fabricar
 *      evidencia.
 *
 * ============================================================
 * "SE MANTIENE" NO ES LO MISMO QUE "NO SE SABE"
 * ============================================================
 *
 * Una serie plana con ruido tiene R² bajo, porque no hay variación que la
 * recta pueda explicar. Rechazarla sería un error: "se mantiene alrededor de
 * X" es una proyección perfectamente buena, y probablemente la más común en un
 * negocio estable. Por eso, antes de mirar el ajuste, se pregunta si la
 * pendiente es despreciable frente a la escala de los datos.
 *
 * Todo acá es puro.
 */

import type { PuntoHistoria } from "../kpi/historia.ts";
import type { Unidad } from "../kpi/tipos.ts";

/** Dos semanas. Menos que esto no es una serie, es un puñado de días. */
export const MINIMO_PARA_PROYECTAR = 14;

/**
 * Cuánta variación tiene que explicar la recta para que valga proyectarla.
 * Por debajo, la serie no tiene forma de recta.
 */
export const AJUSTE_MINIMO = 0.3;

/**
 * Cuándo una pendiente se considera despreciable: si a lo largo de todo el
 * horizonte mueve menos de un 2% del nivel típico, la serie está plana.
 */
export const PENDIENTE_DESPRECIABLE = 0.02;

export type Forma = "sube" | "baja" | "se_mantiene";

export type Proyeccion = {
  indicador: string;
  moneda: string;
  /** A cuántos días vista. */
  dias: number;
  forma: Forma;
  /** El centro de la banda. */
  valor: number;
  /** La banda. Siempre presente: nunca se devuelve un punto solo. */
  minimo: number;
  maximo: number;
  /** R², de 0 a 1. Cuánto de la variación explica la recta. */
  ajuste: number;
  /** Cuántos días reales se usaron. */
  puntos: number;
  supuestos: string[];
  advertencias: string[];
};

/** Cuando no se puede proyectar, se dice por qué en lugar de devolver un número. */
export type NoSePuede = { no_se_puede: string; puntos: number };

export type Resultado = Proyeccion | NoSePuede;

export function esProyeccion(r: Resultado): r is Proyeccion {
  return !("no_se_puede" in r);
}

/**
 * t de Student al 95%, dos colas, por grados de libertad.
 *
 * Con pocos puntos la banda tiene que ser MÁS ancha, no igual. Usar 1,96 para
 * todo —el atajo habitual— angosta la banda justo cuando menos se sabe, que es
 * exactamente al revés de lo que corresponde.
 */
const T_95: Record<number, number> = {
  1: 12.71, 2: 4.3, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31,
  9: 2.26, 10: 2.23, 12: 2.18, 15: 2.13, 20: 2.09, 25: 2.06, 30: 2.04,
  40: 2.02, 60: 2.0, 120: 1.98,
};

function t95(gl: number): number {
  if (gl <= 0) return T_95[1];
  const claves = Object.keys(T_95).map(Number).sort((a, b) => a - b);
  for (const k of claves) if (gl <= k) return T_95[k];
  return 1.96;
}

function dias(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

function sumarDias(fecha: string, n: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Proyecta el indicador `horizonte` días más allá del último dato.
 *
 * `puntos` viene como lo guarda la historia diaria: con nulls en los días que
 * no se pudo calcular. Esos días se saltean, no se rellenan.
 */
export function proyectar(args: {
  indicador: string;
  moneda: string;
  unidad?: Unidad;
  puntos: PuntoHistoria[];
  horizonte: number;
}): Resultado {
  const { indicador, moneda, unidad, puntos, horizonte } = args;

  const validos = puntos
    .filter((p): p is PuntoHistoria & { valor: number } => p.valor !== null)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

  if (validos.length < MINIMO_PARA_PROYECTAR) {
    return {
      no_se_puede: `Hacen falta ${MINIMO_PARA_PROYECTAR} días con dato para proyectar y hay ${validos.length}.`,
      puntos: validos.length,
    };
  }

  // x en días desde el primer punto: así los huecos pesan lo que son. Usar el
  // índice del array trataría un salto de una semana como si fuera un día.
  const origen = validos[0].fecha;
  const xs = validos.map((p) => dias(origen, p.fecha));
  const ys = validos.map((p) => p.valor);
  const n = xs.length;

  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }

  if (sxx === 0) {
    return { no_se_puede: "Todos los datos son del mismo día.", puntos: n };
  }

  const pendiente = sxy / sxx;
  const corte = my - pendiente * mx;

  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i += 1) {
    sse += (ys[i] - (corte + pendiente * xs[i])) ** 2;
    sst += (ys[i] - my) ** 2;
  }

  const ajuste = sst === 0 ? 1 : Math.max(0, 1 - sse / sst);

  // El x que se proyecta: `horizonte` días después del ÚLTIMO dato, no después
  // de hoy. Si la captura viene atrasada, decirlo es tarea de quien llama.
  const ultimo = validos[n - 1];
  const xFuturo = dias(origen, ultimo.fecha) + horizonte;
  const centro = corte + pendiente * xFuturo;

  // ¿La pendiente mueve algo? Se mide contra la escala de los datos, no en
  // absoluto: mil guaraníes de pendiente son nada en un millón y son todo en
  // diez mil.
  const escala = Math.max(Math.abs(my), 1e-9);
  const movimiento = Math.abs(pendiente * horizonte) / escala;
  const plana = movimiento < PENDIENTE_DESPRECIABLE;

  if (!plana && ajuste < AJUSTE_MINIMO) {
    return {
      no_se_puede: `La serie no sigue una línea: la tendencia explica apenas el ${Math.round(ajuste * 100)}% de lo que se movió el indicador.`,
      puntos: n,
    };
  }

  const gl = n - 2;
  const t = t95(gl);
  const s = gl > 0 ? Math.sqrt(sse / gl) : 0;
  // Intervalo de PREDICCIÓN, no de la media: incluye el 1 de adentro. Es la
  // diferencia entre "por dónde pasa la recta" y "dónde va a caer el dato",
  // que es lo que realmente se está preguntando.
  const margen = t * s * Math.sqrt(1 + 1 / n + (xFuturo - mx) ** 2 / sxx);

  const forma: Forma = plana ? "se_mantiene" : pendiente > 0 ? "sube" : "baja";

  const supuestos = [
    `Se asume que lo que pasó estos ${n} días sigue pasando.`,
    "No se tiene en cuenta ninguna estacionalidad: hacen falta más de un año de datos para verla.",
  ];

  const advertencias: string[] = [];

  const huecos = puntos.filter((p) => p.valor === null).length;
  if (huecos > 0) {
    advertencias.push(
      `${huecos} ${huecos === 1 ? "día no tuvo dato y se salteó" : "días no tuvieron dato y se saltearon"}.`,
    );
  }
  if (ajuste < 0.6 && !plana) {
    advertencias.push(`La tendencia explica el ${Math.round(ajuste * 100)}% de lo que se movió: el rango es ancho por algo.`);
  }
  if (horizonte > n) {
    advertencias.push(
      `Se proyecta a ${horizonte} días con ${n} días de historia: cuanto más lejos, menos vale.`,
    );
  }
  if (unidad === "porcentaje" && (centro > 100 || centro < -100)) {
    advertencias.push("La recta llega a un porcentaje que no puede darse: a este horizonte ya no sirve.");
  }
  if (unidad === "moneda" && centro < 0 && my > 0) {
    advertencias.push("La recta cruza a negativo. Puede ser real, o puede ser que la recta ya no describa la serie.");
  }

  return {
    indicador,
    moneda,
    dias: horizonte,
    forma,
    valor: centro,
    minimo: centro - margen,
    maximo: centro + margen,
    ajuste,
    puntos: n,
    supuestos,
    advertencias,
  };
}

/**
 * La fecha a la que corresponde la proyección, para que la pantalla no tenga
 * que recalcularla y arriesgarse a decir otro día.
 */
export function fechaProyectada(puntos: PuntoHistoria[], horizonte: number): string | null {
  const validos = puntos.filter((p) => p.valor !== null).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  if (validos.length === 0) return null;
  return sumarDias(validos[validos.length - 1].fecha, horizonte);
}
