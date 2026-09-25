import { calcularScore, type Dimension } from "./score.ts";
import type { Estado, ResultadoKPI } from "./tipos.ts";

/**
 * El score de cada día, reconstruido desde la foto diaria de los indicadores.
 *
 * ============================================================
 * POR QUÉ EL GRÁFICO NO PUEDE LEER `eos_daily_briefings.score`
 * ============================================================
 *
 * El briefing guarda `coalesce(profile.score_general, latest_intelligence.score, 0)`.
 * Ninguna de las dos fuentes se escribe hoy para la mayoría de las cuentas, así
 * que la columna es un cero de relleno todos los días: el gráfico "Evolución del
 * EOS Score" dibujaba una recta en 0 aunque el negocio y la plata de la persona
 * se movieran.
 *
 * El score que SÍ se calcula —el de los Hallazgos del negocio y el de salud de
 * Personal— sale de `calcularScore` sobre los indicadores. Y el cron del
 * briefing ya guarda cada día, en `eos_kpi_historia_v105`, el valor, el ESTADO y
 * la confianza de cada indicador. Con eso alcanza para rearmar el score de
 * cualquier día con la misma aritmética, sin inventar nada.
 *
 * ============================================================
 * SOLO EL COMPONENTE DE UMBRAL
 * ============================================================
 *
 * `calcularScore` suma dos componentes: el estado contra el umbral declarado y
 * la tendencia contra el período anterior. La historia guarda el estado de ese
 * día pero no su tendencia, y recalcularla con los datos de hoy sería justo lo
 * que `pulso` evita: atribuirle a un día algo que ese día no se midió.
 *
 * Entonces cada punto se puntúa solo por umbral —el mismo criterio para todos
 * los días, hoy incluido—. La serie es comparable consigo misma, que es lo que
 * un gráfico de evolución necesita. Puede diferir unos puntos del score de los
 * Hallazgos, que además suma tendencia; por eso la pantalla no los pone lado a
 * lado como si fueran el mismo número.
 */

export type FilaHistoriaScore = {
  indicador: string;
  moneda: string;
  fecha: string;
  estado: Estado | null;
  confianza: number | null;
};

export type PuntoScoreDiario = { fecha: string; score: number };

export function scoresPorDia(
  filas: FilaHistoriaScore[],
  dimensiones: Dimension[],
  conUmbrales: Set<string>,
): PuntoScoreDiario[] {
  const ids = new Set(dimensiones.flatMap((d) => d.indicadores));

  const porFecha = new Map<string, FilaHistoriaScore[]>();
  for (const f of filas) {
    if (!ids.has(f.indicador)) continue;
    const lista = porFecha.get(f.fecha) ?? [];
    lista.push(f);
    porFecha.set(f.fecha, lista);
  }

  const salida: PuntoScoreDiario[] = [];

  for (const [fecha, delDia] of [...porFecha].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const moneda = monedaMasUsada(delDia);
    if (!moneda) continue;

    const resultados = delDia.map((f) => comoResultado(f));
    const { puntaje } = calcularScore(resultados, conUmbrales, moneda, dimensiones);

    // Un día sin nada puntuable es un hueco, no un cero: cero sería "todo mal".
    if (puntaje !== null) salida.push({ fecha, score: puntaje });
  }

  return salida;
}

/** La moneda con más indicadores ese día, que es la del negocio o la de la persona. */
function monedaMasUsada(filas: FilaHistoriaScore[]): string | null {
  const cuenta = new Map<string, number>();
  for (const f of filas) cuenta.set(f.moneda, (cuenta.get(f.moneda) ?? 0) + 1);
  let mejor: string | null = null;
  for (const [moneda, n] of cuenta) if (mejor === null || n > (cuenta.get(mejor) ?? 0)) mejor = moneda;
  return mejor;
}

/**
 * Lo mínimo de un `ResultadoKPI` que `calcularScore` lee.
 *
 * `tendencia: "desconocida"` apaga el componente de tendencia (ver arriba). Un
 * estado que no se guardó cuenta como `sin_datos`, que no puntúa.
 */
function comoResultado(f: FilaHistoriaScore): ResultadoKPI {
  return {
    id: f.indicador,
    nombre: f.indicador,
    moneda: f.moneda,
    estado: f.estado ?? "sin_datos",
    tendencia: "desconocida",
    direccion: "neutro",
    confianza: { nivel: f.confianza ?? 1, motivos: [] },
  } as unknown as ResultadoKPI;
}
