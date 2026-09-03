import type { Estado, ResultadoKPI } from "./tipos.ts";

/**
 * El EOS Business Score.
 *
 * ============================================================
 * CONTRA QUÉ SE MIDE, Y CONTRA QUÉ NO
 * ============================================================
 *
 * El pedido decía, textual: "No usar una fórmula arbitraria. La metodología
 * debe ser transparente, explicable, configurable, versionada, auditable."
 *
 * La tentación es puntuar contra parámetros de industria —"un margen bueno es
 * 35%"—. EOS no tiene esos datos para Paraguay y no los va a inventar: un
 * número así se ve idéntico a uno fundado y se decide sobre él.
 *
 * Así que el score mide dos cosas que SÍ se pueden sostener:
 *
 *   A. Contra los umbrales que cada indicador declara. Están en su definición
 *      (`lib/kpi/definiciones/`), donde ya tuvieron que justificarse, y son la
 *      misma fuente de la que sale el `estado` que se muestra en pantalla. No
 *      hay una segunda tabla de umbrales que pueda divergir.
 *
 *   B. Contra vos mismo del período anterior. Que un indicador se mueva para
 *      su lado bueno es una noticia buena sin necesidad de compararlo con
 *      nadie.
 *
 * Un indicador sin umbral declarado y sin período anterior NO puntúa. No
 * aporta un 60 de relleno: queda afuera y baja la cobertura.
 *
 * ============================================================
 * LA COBERTURA ES PARTE DEL RESULTADO
 * ============================================================
 *
 * Un 82 calculado sobre tres de siete dimensiones no es el mismo 82 que uno
 * calculado sobre las siete. Sin la cobertura al lado, el número es una
 * opinión disfrazada de medición, así que viaja siempre con él.
 *
 * ============================================================
 * VERSIONADA
 * ============================================================
 *
 * `METODOLOGIA` cambia cada vez que cambia la forma de puntuar. Sin eso, un
 * score de hoy y uno de hace un mes podrían no ser comparables sin que nadie
 * lo note — y la serie histórica mentiría sobre una mejora que fue un cambio
 * de fórmula.
 */

export const METODOLOGIA = "eos-score-v1";

export type Componente = {
  tipo: "umbral" | "tendencia";
  indicador: string;
  nombre: string;
  puntaje: number;
  detalle: string;
};

export type DimensionScore = {
  id: string;
  nombre: string;
  /** 0 a 100. Null cuando ningún indicador de la dimensión pudo puntuar. */
  puntaje: number | null;
  componentes: Componente[];
  /** Por qué es null, cuando lo es. */
  motivo: string | null;
};

export type BusinessScore = {
  metodologia: string;
  moneda: string;
  /** 0 a 100. Null cuando no se pudo puntuar ninguna dimensión. */
  puntaje: number | null;
  /** Qué proporción de las dimensiones se pudo calcular, de 0 a 1. */
  cobertura: number;
  /** Promedio de la confianza de los indicadores que puntuaron. */
  confianza: number;
  dimensiones: DimensionScore[];
};

/**
 * Las dimensiones y de qué indicadores salen.
 *
 * Es la parte "configurable": cambiar qué mide una dimensión es editar esta
 * tabla, no tocar la aritmética. Y es auditable porque cada componente que
 * entró al puntaje vuelve en el resultado con su nombre y su detalle.
 */
export const DIMENSIONES: { id: string; nombre: string; indicadores: string[] }[] = [
  { id: "rentabilidad", nombre: "Rentabilidad", indicadores: ["margen_bruto", "roi", "ganancia"] },
  { id: "crecimiento", nombre: "Crecimiento", indicadores: ["ventas_netas", "ticket_promedio"] },
  { id: "clientes", nombre: "Clientes", indicadores: ["concentracion_clientes", "ciclo_venta"] },
  // `cartera_vencida` reemplazó a `cobros_demorados` en la v107: lo que era
  // "hace más de 30 días de la fecha" ahora se cuenta desde el VENCIMIENTO,
  // que es lo que realmente define un atraso.
  { id: "cobros", nombre: "Cobros", indicadores: ["cartera_vencida", "cuentas_por_cobrar", "dias_de_cobro"] },
  { id: "inventario", nombre: "Inventario", indicadores: ["productos_bajo_minimo", "capital_inmovilizado"] },
  { id: "embudo", nombre: "Embudo", indicadores: ["tasa_conversion", "oportunidades_estancadas"] },
  { id: "caja", nombre: "Caja", indicadores: ["balance_periodo", "gastos_totales"] },
];

const PUNTAJE_ESTADO: Record<Exclude<Estado, "sin_datos">, number> = {
  bien: 100,
  atencion: 55,
  alerta: 20,
};

/** Si moverse en esa dirección es bueno para ese indicador. */
function tendenciaEsBuena(r: ResultadoKPI): boolean | null {
  if (r.direccion === "neutro") return null;
  if (r.tendencia === "desconocida") return null;
  if (r.tendencia === "estable") return null;

  const sube = r.tendencia === "sube";
  return r.direccion === "mas_es_mejor" ? sube : !sube;
}

const PUNTAJE_TENDENCIA: Record<"buena" | "mala", number> = { buena: 100, mala: 20 };

function componentesDe(r: ResultadoKPI, tieneUmbrales: boolean): Componente[] {
  const salida: Componente[] = [];

  // A. Contra su propio umbral declarado.
  if (tieneUmbrales && r.estado !== "sin_datos") {
    salida.push({
      tipo: "umbral",
      indicador: r.id,
      nombre: r.nombre,
      puntaje: PUNTAJE_ESTADO[r.estado],
      detalle: `Está en zona "${r.estado}" según el umbral que declara el indicador.`,
    });
  }

  // B. Contra vos mismo del período anterior.
  const buena = tendenciaEsBuena(r);
  if (buena !== null) {
    salida.push({
      tipo: "tendencia",
      indicador: r.id,
      nombre: r.nombre,
      puntaje: PUNTAJE_TENDENCIA[buena ? "buena" : "mala"],
      detalle: `${r.tendencia === "sube" ? "Subió" : "Bajó"} contra el período anterior, que para este indicador es ${
        buena ? "bueno" : "malo"
      }.`,
    });
  }

  return salida;
}

/**
 * `conUmbrales` dice qué indicadores declaran umbral. Se pasa desde afuera —en
 * vez de leerlo del registro acá adentro— para que esta función siga siendo
 * pura y testeable sin montar el catálogo entero.
 */
export function calcularScore(
  resultados: ResultadoKPI[],
  conUmbrales: Set<string>,
  moneda: string,
): BusinessScore {
  const deMoneda = resultados.filter((r) => r.moneda === moneda);
  const porId = new Map(deMoneda.map((r) => [r.id, r]));

  const confianzas: number[] = [];

  const dimensiones: DimensionScore[] = DIMENSIONES.map((d) => {
    const componentes: Componente[] = [];

    for (const id of d.indicadores) {
      const r = porId.get(id);
      if (!r) continue;

      const suyos = componentesDe(r, conUmbrales.has(id));
      if (suyos.length > 0) confianzas.push(r.confianza.nivel);
      componentes.push(...suyos);
    }

    if (componentes.length === 0) {
      return {
        id: d.id,
        nombre: d.nombre,
        puntaje: null,
        componentes: [],
        motivo: "Todavía no hay con qué puntuarla: sus indicadores no tienen umbral declarado ni período anterior con el cual compararse.",
      };
    }

    const puntaje = componentes.reduce((s, c) => s + c.puntaje, 0) / componentes.length;

    return {
      id: d.id,
      nombre: d.nombre,
      puntaje: Math.round(puntaje),
      componentes,
      motivo: null,
    };
  });

  const puntuadas = dimensiones.filter((d) => d.puntaje !== null);

  return {
    metodologia: METODOLOGIA,
    moneda,
    // Promedio simple de las dimensiones que pudieron puntuar. Sin pesos
    // inventados: no hay forma de sostener que "rentabilidad vale el doble que
    // inventario" para todo negocio, y un peso arbitrario contamina el número
    // entero.
    puntaje:
      puntuadas.length === 0
        ? null
        : Math.round(puntuadas.reduce((s, d) => s + (d.puntaje as number), 0) / puntuadas.length),
    cobertura: Number((puntuadas.length / DIMENSIONES.length).toFixed(3)),
    confianza:
      confianzas.length === 0
        ? 0
        : Number((confianzas.reduce((s, c) => s + c, 0) / confianzas.length).toFixed(3)),
    dimensiones,
  };
}

/**
 * Por qué cambió el score, comparando dimensión por dimensión.
 *
 * Devuelve las que se movieron, de mayor a menor movimiento. Un score que baja
 * ocho puntos sin decir de dónde salieron es un número que no se puede
 * accionar — y el pedido lo decía: "EOS debe explicar exactamente por qué el
 * score cambió".
 */
export function explicarCambio(
  actual: BusinessScore,
  anterior: BusinessScore,
): { dimension: string; antes: number; ahora: number; cambio: number }[] {
  const previas = new Map(anterior.dimensiones.map((d) => [d.id, d]));

  return actual.dimensiones
    .flatMap((d) => {
      const prev = previas.get(d.id);
      if (d.puntaje === null || !prev || prev.puntaje === null) return [];
      if (d.puntaje === prev.puntaje) return [];

      return [
        {
          dimension: d.nombre,
          antes: prev.puntaje,
          ahora: d.puntaje,
          cambio: d.puntaje - prev.puntaje,
        },
      ];
    })
    .sort((a, b) => Math.abs(b.cambio) - Math.abs(a.cambio));
}

/**
 * La advertencia que acompaña al número cuando la cobertura es baja.
 *
 * Null cuando no hace falta. Que aparezca solo cuando importa es lo que hace
 * que se lea el día que aparece.
 */
export function avisoDeCobertura(score: BusinessScore): string | null {
  if (score.cobertura >= 0.7) return null;

  const puntuadas = score.dimensiones.filter((d) => d.puntaje !== null).length;
  return `Calculado sobre ${puntuadas} de ${DIMENSIONES.length} dimensiones. Todavía no es una foto completa del negocio.`;
}
