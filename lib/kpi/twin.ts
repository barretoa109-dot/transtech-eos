import { createHash } from "node:crypto";
import { calcularScore, type BusinessScore } from "./score.ts";
import type { Anomalia } from "./anomalias.ts";
import type { ResultadoKPI } from "./tipos.ts";

/**
 * El gemelo del negocio, escrito desde TypeScript por primera vez.
 *
 * ============================================================
 * LA TABLA EXISTÍA Y ESTABA VACÍA
 * ============================================================
 *
 * `eos_business_twins_v14` se creó en agosto con trece campos jsonb —
 * identidad, estado actual, estado deseado, brechas, capacidades, riesgos,
 * oportunidades, prioridades y tres perfiles— más un `intelligence_score`,
 * una confianza y snapshots versionados. Nunca la escribió nadie: cero filas,
 * y `grep business_twin` sobre el repo no daba un solo resultado. El ciclo
 * vivía entero en n8n y ni siquiera llegó a poblarla.
 *
 * ============================================================
 * SE LLENA LO QUE SE PUEDE LLENAR CON VERDAD
 * ============================================================
 *
 * La tentación es completar los trece campos para que la fila "se vea
 * completa". No: `desired_state` sale de una conversación con el usuario que
 * todavía no existe, y `capabilities` de un inventario que nadie cargó.
 * Rellenarlos con algo plausible los volvería indistinguibles de los que sí
 * salen de datos, y el día que alguien construya encima no va a saber cuáles
 * creer.
 *
 * Entonces se escriben cuatro, todos derivados de hechos:
 *
 *   · `current_state` — los indicadores del día, con su valor y su estado.
 *   · `risks` — las anomalías detectadas, con su evidencia.
 *   · `priorities` — las mismas anomalías, ordenadas por prioridad.
 *   · `intelligence_score` / `confidence` / `source_completeness` — el Business
 *     Score, su confianza y su cobertura.
 *
 * Los demás quedan en null. Un null dice "esto todavía no se sabe", que es
 * exactamente la verdad.
 */

export const MODELO = "business-twin-eos-kpi-v1";

export type FilaTwin = {
  usuario_id: string;
  model_version: string;
  source_fingerprint: string;
  current_state: unknown;
  risks: unknown;
  priorities: unknown;
  intelligence_score: number | null;
  confidence: number;
  source_completeness: number;
  generated_at: string;
  metadata: unknown;
};

/**
 * La huella de los datos de origen.
 *
 * La tabla la tiene desde su diseño original y sirve para no reescribir una
 * fila idéntica: si el fingerprint no cambió, el gemelo tampoco. Se arma con
 * los valores y estados de los indicadores —no con la fecha— para que dos
 * corridas del mismo día con los mismos datos den lo mismo.
 */
export function huella(resultados: ResultadoKPI[]): string {
  const material = resultados
    .map((r) => `${r.id}:${r.moneda}:${r.valor ?? "null"}:${r.estado}`)
    .sort()
    .join("|");

  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function armarTwin(datos: {
  usuarioId: string;
  resultados: ResultadoKPI[];
  anomalias: Anomalia[];
  score: BusinessScore;
  generadoEn: string;
}): FilaTwin {
  const { usuarioId, resultados, anomalias, score, generadoEn } = datos;

  return {
    usuario_id: usuarioId,
    model_version: MODELO,
    source_fingerprint: huella(resultados),

    current_state: {
      moneda: score.moneda,
      indicadores: resultados
        .filter((r) => r.moneda === score.moneda)
        .map((r) => ({
          id: r.id,
          nombre: r.nombre,
          valor: r.valor,
          unidad: r.unidad,
          estado: r.estado,
          tendencia: r.tendencia,
          // Va el motivo cuando no hay valor: un null sin explicación adentro
          // de un jsonb es un dato que nadie va a poder interpretar después.
          falta: r.falta,
          confianza: r.confianza.nivel,
        })),
    },

    risks: anomalias
      .filter((a) => a.severidad === "critico" || a.severidad === "atencion")
      .map((a) => ({
        clave: a.clave,
        indicador: a.indicador,
        severidad: a.severidad,
        clase: a.clase,
        titulo: a.titulo,
        evidencia: a.evidencia,
      })),

    priorities: anomalias.slice(0, 5).map((a, i) => ({
      orden: i + 1,
      clave: a.clave,
      titulo: a.titulo,
      prioridad: a.prioridad,
    })),

    intelligence_score: score.puntaje,
    confidence: score.confianza,
    source_completeness: score.cobertura,
    generated_at: generadoEn,

    metadata: {
      metodologia: score.metodologia,
      dimensiones: score.dimensiones.map((d) => ({
        id: d.id,
        puntaje: d.puntaje,
        motivo: d.motivo,
      })),
      /*
       * Qué campos del gemelo NO se llenaron y por qué.
       *
       * Va adentro de la fila y no en un comentario del código porque quien
       * lea esta tabla dentro de seis meses —o el propio EOS al construir
       * encima— necesita saber que esos nulls son deliberados y qué haría
       * falta para llenarlos.
       */
      sin_llenar: {
        identity: "Necesita los datos de la empresa: rubro, tamaño, antigüedad. Nadie los cargó.",
        desired_state: "Sale de una conversación de objetivos con el usuario que todavía no existe.",
        gaps: "Es la distancia entre current_state y desired_state; sin el segundo no se puede calcular.",
        constraints: "Necesita que el usuario declare sus límites (capital, tiempo, personal).",
        capabilities: "Necesita un inventario de qué sabe y puede hacer el negocio.",
        opportunities: "Hoy solo se detectan riesgos; las oportunidades exigen comparar contra algo.",
        execution_profile: "Necesita historia de acciones ejecutadas y su resultado.",
        learning_profile: "Vive en eos_learnings; todavía no se cruza con esto.",
        autonomy_profile: "Vive en eos_autonomy_profiles_v12; todavía no se cruza con esto.",
      },
    },
  };
}

/**
 * Si vale la pena reescribir el gemelo.
 *
 * Con el mismo fingerprint la fila sería idéntica salvo la hora, así que se
 * deja la que está. Es el mismo criterio que ya tenía previsto la migración
 * original (`eos_ignore_identical_twin_snapshot_v28`) y evita llenar los
 * snapshots de versiones que no cambian nada.
 */
export function convieneEscribir(nueva: FilaTwin, huellaPrevia: string | null): boolean {
  return huellaPrevia !== nueva.source_fingerprint;
}

/** El score de la moneda con más indicadores, que es la del negocio. */
export function monedaPrincipal(resultados: ResultadoKPI[]): string | null {
  const cuenta = new Map<string, number>();
  for (const r of resultados) cuenta.set(r.moneda, (cuenta.get(r.moneda) ?? 0) + 1);

  const orden = [...cuenta].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return orden.length > 0 ? orden[0][0] : null;
}

/** Atajo para armar el score de la moneda principal. */
export function scorePrincipal(
  resultados: ResultadoKPI[],
  conUmbrales: Set<string>,
): BusinessScore | null {
  const moneda = monedaPrincipal(resultados);
  return moneda === null ? null : calcularScore(resultados, conUmbrales, moneda);
}
