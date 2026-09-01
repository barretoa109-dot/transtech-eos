import { embudoPorMoneda, type OportunidadConMoneda } from "../../crm/embudo.ts";
import { monedaConocida } from "../../finanzas/monedas.ts";
import { valorConocido, valorDesconocido } from "../tipos.ts";
import type { ActividadHecho, DefinicionKPI, Hechos, OportunidadHecho, Periodo, ValorKPI } from "../tipos.ts";

/**
 * El pipeline comercial. `valor_pipeline` y `pipeline_ponderado` no
 * reimplementan la cuenta: la toman de `lib/crm/embudo.ts`
 * (`embudoPorMoneda`), que ya sabe agrupar por moneda y ponderar por
 * probabilidad de etapa, y que ya usa la pantalla del embudo.
 *
 * Las dos son `instantanea`: el pipeline de hoy no es la suma de nada dentro
 * de un período, es una foto de las oportunidades abiertas en este momento.
 * Ver la nota en `lib/kpi/tipos.ts` sobre por qué una foto no se compara
 * contra "el período anterior".
 */

function comoOportunidadesConMoneda(hechos: Hechos): OportunidadConMoneda[] {
  return (hechos.oportunidades ?? []).map((o) => ({
    monto: o.monto,
    etapa: o.etapa,
    moneda: monedaConocida(o.moneda),
  }));
}

export const VALOR_PIPELINE: DefinicionKPI = {
  id: "valor_pipeline",
  nombre: "Valor del pipeline",
  familia: "crm",
  unidad: "moneda",
  direccion: "mas_es_mejor",
  necesita: ["oportunidades"],
  instantanea: true,
  calcular(hechos): ValorKPI[] {
    return embudoPorMoneda(comoOportunidadesConMoneda(hechos)).map((e) =>
      valorConocido(e.moneda, e.en_juego),
    );
  },
};

export const PIPELINE_PONDERADO: DefinicionKPI = {
  id: "pipeline_ponderado",
  nombre: "Pipeline ponderado por probabilidad",
  familia: "crm",
  unidad: "moneda",
  direccion: "mas_es_mejor",
  necesita: ["oportunidades"],
  instantanea: true,
  calcular(hechos): ValorKPI[] {
    return embudoPorMoneda(comoOportunidadesConMoneda(hechos)).map((e) =>
      valorConocido(e.moneda, e.esperado),
    );
  },
};

/**
 * Ganadas contra ganadas+perdidas, de lo que se CERRÓ en el período. Esto sí
 * es de período —una tasa de conversión de agosto tiene sentido comparada
 * con la de julio— y por eso no lleva `instantanea`.
 */
export const TASA_CONVERSION: DefinicionKPI = {
  id: "tasa_conversion",
  nombre: "Tasa de conversión",
  familia: "crm",
  unidad: "porcentaje",
  direccion: "mas_es_mejor",
  necesita: ["oportunidades"],
  umbrales: { atencion: 20, alerta: 10 },
  calcular(hechos, periodo): ValorKPI[] {
    const cerradas = (hechos.oportunidades ?? []).filter(
      (o) => o.cerrada_en !== null && o.cerrada_en >= periodo.desde && o.cerrada_en <= periodo.hasta,
    );
    const monedas = new Set(cerradas.map((o) => monedaConocida(o.moneda)));

    return [...monedas].sort().map((moneda) => {
      const deMoneda = cerradas.filter((o) => monedaConocida(o.moneda) === moneda);
      const ganadas = deMoneda.filter((o) => o.etapa === "ganada").length;
      const perdidas = deMoneda.filter((o) => o.etapa === "perdida").length;
      const total = ganadas + perdidas;

      return total > 0
        ? valorConocido(moneda, (ganadas / total) * 100)
        : valorDesconocido(moneda, "No se cerró ninguna oportunidad en el período");
    });
  },
};

/**
 * Cuántos días desde `a` hasta `b`, en UTC. El mismo cálculo que ya usa
 * `lib/erp/riesgos-negocio.ts` para "cobros demorados" — no se reimporta
 * porque ahí es una función privada del módulo, pero es la misma cuenta.
 */
function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** La fecha del último contacto real (actividad marcada hecha), o null si nunca hubo una. */
function ultimaActividadDe(oportunidadId: string, actividades: ActividadHecho[]): string | null {
  const hechas = actividades.filter((a) => a.oportunidad_id === oportunidadId && a.hecha);
  if (hechas.length === 0) return null;
  return hechas.reduce((max, a) => (a.fecha > max ? a.fecha : max), hechas[0].fecha);
}

/**
 * A partir de cuántos días sin actividad una oportunidad abierta es una
 * noticia. Es el mismo umbral del ejemplo del punto 7 del pedido original:
 * "Gs. 73.000.000 en oportunidades sin actividad durante más de 14 días."
 */
const DIAS_ESTANCADA = 14;

/**
 * Foto de hoy, no suma del período: por eso usa `periodo.hasta` como "hoy" —
 * nunca `new Date()` adentro de una cuenta, que es la regla de
 * `lib/fecha.ts`— y por eso es `instantanea`.
 */
export const OPORTUNIDADES_ESTANCADAS: DefinicionKPI = {
  id: "oportunidades_estancadas",
  nombre: "Oportunidades sin actividad hace más de 14 días",
  familia: "crm",
  unidad: "cantidad",
  direccion: "menos_es_mejor",
  necesita: ["oportunidades", "actividades"],
  instantanea: true,
  umbrales: { atencion: 1, alerta: 5 },
  calcular(hechos, periodo: Periodo): ValorKPI[] {
    const hoy = periodo.hasta;
    const abiertas = (hechos.oportunidades ?? []).filter(
      (o: OportunidadHecho) => o.etapa !== "ganada" && o.etapa !== "perdida",
    );
    const actividades = hechos.actividades ?? [];

    const estaEstancada = (o: OportunidadHecho) => {
      const ultima = ultimaActividadDe(o.id, actividades) ?? o.creado_en;
      return diasEntre(ultima, hoy) > DIAS_ESTANCADA;
    };

    const monedas = new Set(abiertas.map((o) => monedaConocida(o.moneda)));

    return [...monedas].sort().map((moneda) => {
      const cantidad = abiertas.filter(
        (o) => monedaConocida(o.moneda) === moneda && estaEstancada(o),
      ).length;
      return valorConocido(moneda, cantidad);
    });
  },
};

export const DEFINICIONES_CRM: DefinicionKPI[] = [
  VALOR_PIPELINE,
  PIPELINE_PONDERADO,
  TASA_CONVERSION,
  OPORTUNIDADES_ESTANCADAS,
];
