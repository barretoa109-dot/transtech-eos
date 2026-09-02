import type {
  ClaveHecho,
  DefinicionKPI,
  Estado,
  Hechos,
  Periodo,
  ResultadoKPI,
  Tendencia,
} from "./tipos.ts";
import { periodoAnterior } from "./periodo.ts";

/**
 * El motor: corre un catálogo de definiciones sobre un mismo paquete de datos.
 *
 * No sabe de ERP, ni de CRM, ni de finanzas — eso vive en cada
 * `DefinicionKPI` (ver `lib/kpi/definiciones/**`). Lo único que hace acá es lo
 * que sería tedioso y fácil de hacer distinto en cada indicador si viviera en
 * cada uno: comparar contra el período anterior, decidir tendencia y estado, y
 * saltar los indicadores a los que les falta un insumo.
 */

const TOLERANCIA_ESTABLE = 1e-9;

function estadoDe(def: DefinicionKPI, valor: number | null): Estado {
  if (valor === null) return "sin_datos";
  if (!def.umbrales) return "bien";

  const { atencion, alerta } = def.umbrales;

  // "menos_es_mejor" (p. ej. días de cobro): un valor ALTO es lo que preocupa.
  if (def.direccion === "menos_es_mejor") {
    if (valor > alerta) return "alerta";
    if (valor > atencion) return "atencion";
    return "bien";
  }

  // "mas_es_mejor" (p. ej. margen): un valor BAJO es lo que preocupa.
  if (def.direccion === "mas_es_mejor") {
    if (valor < alerta) return "alerta";
    if (valor < atencion) return "atencion";
    return "bien";
  }

  // "neutro" (p. ej. ticket promedio): no hay un lado bueno, no se alarma solo.
  return "bien";
}

function tendenciaDe(valor: number | null, anterior: number | null): Tendencia {
  if (valor === null || anterior === null) return "desconocida";
  if (Math.abs(valor - anterior) < TOLERANCIA_ESTABLE) return "estable";
  return valor > anterior ? "sube" : "baja";
}

/**
 * Calcula un catálogo de KPIs para un período, contra el período anterior de
 * igual largo.
 *
 * El motor no decide qué monedas hay: cada definición lee las suyas de
 * `Hechos` y devuelve un valor por moneda. Acá solo se empareja el valor
 * actual con el anterior de la MISMA moneda — si esa moneda no tenía valor
 * antes, no se inventa un cero: la tendencia queda "desconocida", como
 * corresponde a algo que antes no existía.
 */
export function calcular(
  definiciones: DefinicionKPI[],
  hechos: Hechos,
  periodo: Periodo,
): ResultadoKPI[] {
  const anterior = periodoAnterior(periodo);
  const calculadoEn = new Date().toISOString();
  const resultados: ResultadoKPI[] = [];

  for (const def of definicionesCalculables(definiciones, hechos)) {
    const actuales = def.calcular(hechos, periodo);

    // Una foto del momento no tiene "período anterior": pedirle el mismo
    // cálculo con otras fechas da el mismo número, y leer eso como "estable"
    // sería inventar una tendencia que nadie midió.
    const anteriorPorMoneda = def.instantanea
      ? new Map<string, number | null>()
      : new Map(def.calcular(hechos, anterior).map((v) => [v.moneda, v.valor]));

    for (const v of actuales) {
      const valorAnterior = anteriorPorMoneda.get(v.moneda) ?? null;
      const variacion = v.valor !== null && valorAnterior !== null ? v.valor - valorAnterior : null;
      const variacion_pct =
        variacion !== null && valorAnterior !== null && valorAnterior !== 0
          ? (variacion / valorAnterior) * 100
          : null;

      resultados.push({
        id: def.id,
        nombre: def.nombre,
        familia: def.familia,
        unidad: def.unidad,
        direccion: def.direccion,
        moneda: v.moneda,
        valor: v.valor,
        anterior: valorAnterior,
        variacion,
        variacion_pct,
        tendencia: tendenciaDe(v.valor, valorAnterior),
        estado: estadoDe(def, v.valor),
        periodo,
        calculado_en: calculadoEn,
        confianza: v.confianza,
        falta: v.falta,
      });
    }
  }

  return resultados;
}

/** Las definiciones a las que `Hechos` les dio todo lo que declararon en `necesita`. */
function definicionesCalculables(definiciones: DefinicionKPI[], hechos: Hechos): DefinicionKPI[] {
  return definiciones.filter((def) => def.necesita.every((clave) => hechos[clave] !== undefined));
}

/**
 * Lo que el motor NO pudo calcular por falta de insumos, y qué le faltó.
 *
 * Es el equivalente, a nivel de motor, de `loQueFalta()` en
 * `lib/erp/indicadores.ts`: un tablero que dice lo que no sabe vale más que
 * uno que se queda callado y listo.
 */
export function insumosFaltantes(
  definiciones: DefinicionKPI[],
  hechos: Hechos,
): { id: string; nombre: string; falta: ClaveHecho[] }[] {
  return definiciones
    .map((def) => ({
      id: def.id,
      nombre: def.nombre,
      falta: def.necesita.filter((clave) => hechos[clave] === undefined),
    }))
    .filter((d) => d.falta.length > 0);
}
