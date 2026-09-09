import type { Confianza, Periodo, ResultadoKPI, Tendencia } from "../kpi/tipos.ts";
import { UTILIZACION_QUE_APRIETA } from "./tarjetas.ts";

/**
 * El pulso de la persona: seis indicadores que se pueden comparar y explicar.
 *
 * ============================================================
 * ESTO NO ES UN MOTOR NUEVO
 * ============================================================
 *
 * `lib/kpi/` ya tiene todo lo que hace falta para detectar anomalías, ordenar
 * hallazgos por impacto × urgencia × confianza y armar un score explicable. Lo
 * único que le falta a Personal es hablar ese idioma: producir `ResultadoKPI`.
 *
 * Eso hace este módulo. Después `detectarAnomalias`, `ordenar` y
 * `calcularScore` funcionan igual que para el negocio, sin una línea nueva de
 * aritmética y sin una segunda forma de decidir qué es grave.
 *
 * ============================================================
 * POR QUÉ NO SE AGREGAN AL CATÁLOGO DEL NEGOCIO
 * ============================================================
 *
 * Sería lo cómodo: una familia `personal` en `lib/kpi/registro.ts` y listo.
 * Pero entonces `/api/kpi?familia=…` y el tablero del negocio tendrían que
 * acordarse de excluirla, y bastaría UNA consulta sin ese filtro para que el
 * alquiler de la casa de alguien apareciera entre los indicadores de su
 * empresa.
 *
 * Es exactamente el error que este proyecto ya cometió dos veces: los lechones
 * en el panel personal (v136) y el préstamo del auto en el capital de trabajo
 * del negocio (v143). Con dos catálogos separados no hay filtro que olvidar.
 *
 * Los ids llevan el prefijo `pers_` para que, en la tabla de historia que
 * comparten, tampoco se puedan confundir.
 *
 * ============================================================
 * LOS UMBRALES SALEN DE LA PERSONA, NO DE UN MANUAL
 * ============================================================
 *
 * Cuatro de los seis se comparan contra algo que ella misma declaró: el
 * porcentaje de ahorro de su Constitución, los meses de cobertura que eligió
 * para su fondo, y su propia mediana de gasto. Eso no es un parámetro de
 * industria: es su decisión, y por eso se puede discutir con ella.
 *
 * Los dos que sí necesitan una constante —los días de colchón y la carga de
 * deuda— la declaran acá arriba con su motivo. Ninguno sale de "los expertos
 * recomiendan".
 *
 * Es puro: recibe números ya calculados y no toca la base.
 */

/**
 * Días de colchón: una semana y tres semanas.
 *
 * Siete días es el tiempo mínimo para reaccionar a algo —conseguir un
 * adelanto, mover un pago, vender algo—. Por debajo, cualquier imprevisto ya
 * es un problema.
 *
 * Veintiuno cubre el tramo entre dos cobros mensuales con margen. No es una
 * regla financiera: es la duración del ciclo en el que vive la mayoría de la
 * gente que cobra por mes.
 */
const COLCHON_ALERTA_DIAS = 7;
const COLCHON_ATENCION_DIAS = 21;

/**
 * Carga de deuda: 30% y 40% del ingreso.
 *
 * No es una opinión sobre cuánto conviene deber. Es el rango en el que los
 * propios bancos y financieras de Paraguay dejan de prestar, así que por
 * encima de eso la persona pierde la capacidad de refinanciar justo cuando más
 * la necesita. Es un hecho del entorno, verificable, y por eso se puede usar.
 */
const CARGA_ATENCION_PCT = 30;
const CARGA_ALERTA_PCT = 40;

/** Días de un mes promedio, para pasar un gasto mensual a diario. */
const DIAS_POR_MES = 30.4375;

export const DIMENSIONES_PERSONALES = [
  { id: "colchon", nombre: "Colchón", indicadores: ["pers_dias_de_colchon", "pers_disponible_real"] },
  { id: "deuda", nombre: "Deuda", indicadores: ["pers_carga_de_deuda", "pers_deuda_total"] },
  { id: "ahorro", nombre: "Ahorro", indicadores: ["pers_tasa_de_ahorro", "pers_cobertura_del_fondo"] },
  { id: "gasto", nombre: "Gasto", indicadores: ["pers_gasto_del_mes"] },
  { id: "tarjetas", nombre: "Tarjetas", indicadores: ["pers_utilizacion_tarjetas"] },
];

export type EntradaPulso = {
  hoy: string;
  moneda: string;
  periodo: Periodo;

  /** Lo que queda después de compromisos, reserva y ahorro. */
  disponibleReal: number;
  /** La mediana de gasto de los meses anteriores. `null` sin historial. */
  gastoHabitualMensual: number | null;
  /** Lo gastado en el mes en curso. */
  gastoDelMes: number;
  /** Lo cobrado en el mes en curso. */
  ingresoDelMes: number;

  /** Lo que debe hoy, según lo declarado. */
  deudaTotal: number;
  /** Lo que se le va por mes en cuotas, tarjetas incluidas. */
  cuotasMensuales: number;

  /** El porcentaje que dijo querer ahorrar, de 0 a 100. */
  porcentajeAhorroDeclarado: number;

  /** Meses de gasto esencial que cubre su fondo. `null` sin gasto esencial. */
  mesesCubiertos: number | null;
  /** Los meses que eligió cubrir. `null` mientras no elija. */
  mesesElegidos: number | null;

  /** La utilización más alta de sus tarjetas, de 0 a 1. `null` sin tarjetas. */
  utilizacionMaxima: number | null;

  /**
   * Los mismos números de un momento anterior, para poder decir qué cambió.
   *
   * Vienen de la historia diaria, no de recalcular: comparar contra un cálculo
   * hecho hoy con datos de ayer daría diferencias que son de la fórmula y no
   * de la plata.
   */
  anterior?: Partial<Record<string, number | null>>;
};

export function indicadoresPersonales(e: EntradaPulso): ResultadoKPI[] {
  const gastoDiario = e.gastoHabitualMensual === null ? null : e.gastoHabitualMensual / DIAS_POR_MES;

  const dias =
    gastoDiario === null || gastoDiario <= 0 ? null : redondear(e.disponibleReal / gastoDiario, 1);

  const carga =
    e.ingresoDelMes > 0 ? redondear((e.cuotasMensuales / e.ingresoDelMes) * 100, 1) : null;

  const ahorrado = e.ingresoDelMes - e.gastoDelMes;
  const tasa = e.ingresoDelMes > 0 ? redondear((ahorrado / e.ingresoDelMes) * 100, 1) : null;

  const utilizacion = e.utilizacionMaxima === null ? null : redondear(e.utilizacionMaxima * 100, 1);

  return [
    armar(e, {
      id: "pers_dias_de_colchon",
      nombre: "Días que aguantás",
      unidad: "dias",
      direccion: "mas_es_mejor",
      valor: dias,
      falta:
        e.gastoHabitualMensual === null
          ? "todavía no tengo un mes completo para saber cuánto gastás"
          : null,
      umbrales: { atencion: COLCHON_ATENCION_DIAS, alerta: COLCHON_ALERTA_DIAS },
    }),

    /*
     * El único umbral que no depende de la persona: el cero.
     *
     * Un disponible negativo significa que ya está comprometido más de lo
     * que tiene, y eso no es una opinión sobre cuánto conviene tener: es una
     * cuenta que no cierra. Sin este umbral el indicador decía `bien` sobre
     * un −49.500.000, que fue lo que apareció en una cuenta real el 8 de
     * septiembre de 2026.
     *
     * CUÁNTO tener por encima de cero sí depende de cada persona, y para eso
     * está `pers_dias_de_colchon`, que lo mide contra su propio gasto.
     */
    armar(e, {
      id: "pers_disponible_real",
      nombre: "Disponible real",
      unidad: "moneda",
      direccion: "mas_es_mejor",
      valor: e.disponibleReal,
      falta: null,
      umbrales: { atencion: 0.01, alerta: 0 },
    }),

    armar(e, {
      id: "pers_carga_de_deuda",
      nombre: "Cuánto de lo que cobrás se va en cuotas",
      unidad: "porcentaje",
      direccion: "menos_es_mejor",
      valor: carga,
      falta: e.ingresoDelMes > 0 ? null : "todavía no registré ningún ingreso este mes",
      umbrales: { atencion: CARGA_ATENCION_PCT, alerta: CARGA_ALERTA_PCT },
    }),

    armar(e, {
      id: "pers_deuda_total",
      nombre: "Lo que debés",
      unidad: "moneda",
      direccion: "menos_es_mejor",
      valor: e.deudaTotal,
      falta: null,
    }),

    /*
     * El umbral de la tasa de ahorro es SU porcentaje, no uno recomendado.
     *
     * Quien declaró que quiere ahorrar el 20% está bien cuando ahorra 20 y en
     * atención cuando ahorra 12. Quien declaró 0 no tiene contra qué medirse, y
     * entonces no hay umbral: el indicador informa y no juzga.
     */
    armar(e, {
      id: "pers_tasa_de_ahorro",
      nombre: "Cuánto de lo que cobrás te queda",
      unidad: "porcentaje",
      direccion: "mas_es_mejor",
      valor: tasa,
      falta: e.ingresoDelMes > 0 ? null : "todavía no registré ningún ingreso este mes",
      umbrales:
        e.porcentajeAhorroDeclarado > 0
          ? {
              atencion: e.porcentajeAhorroDeclarado,
              alerta: redondear(e.porcentajeAhorroDeclarado / 2, 1),
            }
          : undefined,
    }),

    armar(e, {
      id: "pers_cobertura_del_fondo",
      nombre: "Meses que cubre tu fondo",
      unidad: "cantidad",
      direccion: "mas_es_mejor",
      valor: e.mesesCubiertos,
      falta:
        e.mesesCubiertos === null
          ? "todavía no sé cuánto te cuesta un mes de vida"
          : null,
      // Igual que arriba: la meta es la que ELIGIÓ, no una recomendada.
      umbrales:
        e.mesesElegidos !== null
          ? { atencion: e.mesesElegidos, alerta: redondear(e.mesesElegidos / 2, 1) }
          : undefined,
    }),

    /*
     * El gasto del mes no lleva umbral: un monto solo no es bueno ni malo.
     * Lo que lo vuelve noticia es moverse contra SU propia mediana, y de eso
     * se encarga `detectarAnomalias` con el `anterior` que va acá abajo.
     *
     * Igual que `pers_deuda_total`, por convención del motor informa `bien`
     * cuando tiene valor. No es un veredicto: los indicadores sin umbral
     * quedan fuera de `CON_UMBRALES_PERSONALES` y no puntúan en el score.
     * Cualquier corte absoluto —cinco millones de deuda es mucho para una
     * persona y nada para otra— sería inventado.
     */
    armar(e, {
      id: "pers_gasto_del_mes",
      nombre: "Lo que llevás gastado",
      unidad: "moneda",
      direccion: "menos_es_mejor",
      valor: e.gastoDelMes,
      falta: null,
      anteriorExplicito: e.gastoHabitualMensual,
    }),

    armar(e, {
      id: "pers_utilizacion_tarjetas",
      nombre: "Cuánto usás de tus tarjetas",
      unidad: "porcentaje",
      direccion: "menos_es_mejor",
      valor: utilizacion,
      falta: e.utilizacionMaxima === null ? "no tenés tarjetas con línea cargada" : null,
      umbrales: { atencion: UTILIZACION_QUE_APRIETA * 100, alerta: 90 },
    }),
  ];
}

/** Los ids que declaran umbral, para `calcularScore`. */
export const CON_UMBRALES_PERSONALES = new Set([
  "pers_disponible_real",
  "pers_dias_de_colchon",
  "pers_carga_de_deuda",
  "pers_tasa_de_ahorro",
  "pers_cobertura_del_fondo",
  "pers_utilizacion_tarjetas",
]);

function armar(
  e: EntradaPulso,
  d: {
    id: string;
    nombre: string;
    unidad: ResultadoKPI["unidad"];
    direccion: ResultadoKPI["direccion"];
    valor: number | null;
    falta: string | null;
    umbrales?: { atencion: number; alerta: number };
    /** Contra qué comparar, cuando no es el valor del período anterior. */
    anteriorExplicito?: number | null;
  },
): ResultadoKPI {
  const anterior =
    d.anteriorExplicito !== undefined ? d.anteriorExplicito : (e.anterior?.[d.id] ?? null);

  const variacion = d.valor !== null && anterior !== null ? redondear(d.valor - anterior, 2) : null;

  const variacionPct =
    variacion !== null && anterior !== null && anterior !== 0
      ? redondear((variacion / Math.abs(anterior)) * 100, 1)
      : null;

  const tendencia: Tendencia =
    variacion === null ? "desconocida" : variacion > 0 ? "sube" : variacion < 0 ? "baja" : "estable";

  const confianza: Confianza =
    d.falta === null ? { nivel: 1, motivos: [] } : { nivel: 0, motivos: [d.falta] };

  return {
    id: d.id,
    nombre: d.nombre,
    // La familia del catálogo compartido. El prefijo `pers_` del id es lo que
    // los separa; la familia solo dice de qué habla el número.
    familia: "finanzas",
    unidad: d.unidad,
    direccion: d.direccion,
    moneda: e.moneda,
    valor: d.valor,
    anterior,
    variacion,
    variacion_pct: variacionPct,
    tendencia,
    estado: estadoDe(d.valor, d.direccion, d.umbrales),
    periodo: e.periodo,
    calculado_en: e.hoy,
    confianza,
    falta: d.falta,
  };
}

/**
 * El estado, con los umbrales YA orientados por dirección.
 *
 * Para "más es mejor" un valor por debajo del umbral es peor; para "menos es
 * mejor", por encima. Es el mismo criterio que usa el motor del negocio, y se
 * repite acá en vez de importarse porque allá vive adentro de la función que
 * arma resultados desde definiciones, que es una máquina que este módulo no
 * usa.
 */
function estadoDe(
  valor: number | null,
  direccion: ResultadoKPI["direccion"],
  umbrales?: { atencion: number; alerta: number },
): ResultadoKPI["estado"] {
  if (valor === null) return "sin_datos";
  if (!umbrales) return "bien";

  if (direccion === "mas_es_mejor") {
    if (valor < umbrales.alerta) return "alerta";
    if (valor < umbrales.atencion) return "atencion";
    return "bien";
  }

  if (direccion === "menos_es_mejor") {
    if (valor > umbrales.alerta) return "alerta";
    if (valor > umbrales.atencion) return "atencion";
    return "bien";
  }

  return "bien";
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Number.isFinite(valor) ? Math.round(valor * factor) / factor : 0;
}
