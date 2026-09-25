import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import {
  asegurarFotoDeHoy,
  leerSeriesDeScore,
  sincronizarScoreDeBriefings,
  type DiagnosticoScore,
  type SeriesDeScore,
} from "@/lib/kpi/scoreBriefing";
import { motivo } from "@/lib/kpi/capturar";

export const dynamic = "force-dynamic";

const BRIEFING_COLUMNS =
  "id,briefing_date,estado,tipo_usuario,saludo,titulo_dia,resumen,enfoque_dia,prioridad_1,prioridad_2,prioridad_3,recomendacion_principal,logros,riesgos,proximos_pasos,fuentes,score,modelo_version,generated_at,created_at,updated_at" as const;

export async function GET() {
  // El briefing es una función que se contrata. `exigirModulo` también
  // resuelve la sesión: sumarle un `getUser()` serían dos validaciones de
  // token por request.
  const puerta = await exigirModulo("briefing");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const user = { id: puerta.usuarioId };

  /*
   * El score real va ANTES de leer los briefings: se escribe en
   * `eos_daily_briefings.score` y la lectura de abajo ya lo trae corregido.
   * Ver `lib/kpi/scoreBriefing.ts` para por qué el score guardado era un 0.
   */
  const { series, diagnostico } = await scoreReal(user.id);

  const { data, error } = await supabase
    .from("eos_daily_briefings")
    .select(BRIEFING_COLUMNS)
    .eq("usuario_id", user.id)
    .not("briefing_date", "is", null)
    .eq("estado", "listo")
    .order("briefing_date", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(7);

  if (error) {
    console.error("No se pudo cargar el briefing diario:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tu briefing en este momento." },
      {
        status: 500,
        headers: noStoreHeaders(),
      },
    );
  }

  const briefings = data ?? [];
  const latest = briefings[0] ?? null;

  /*
   * La serie del gráfico va aparte y liviana.
   *
   * `history` trae los últimos 7 briefings completos —textos, riesgos,
   * fuentes— y con eso el gráfico del Dashboard no podía mostrar más que una
   * semana: los filtros de 30, 90 y 365 días recortaban una lista que nunca
   * tuvo más de 7 filas. Subir el límite de `history` mandaría un año de
   * textos para dibujar dos números por día; acá van solo la fecha y el score.
   */
  const desde = new Date();
  desde.setDate(desde.getDate() - 366);
  const { data: serie, error: errorSerie } = await supabase
    .from("eos_daily_briefings")
    .select("briefing_date,score,generated_at")
    .eq("usuario_id", user.id)
    .eq("estado", "listo")
    .not("briefing_date", "is", null)
    .not("score", "is", null)
    .gte("briefing_date", desde.toISOString().slice(0, 10))
    .order("briefing_date", { ascending: true })
    .order("generated_at", { ascending: true })
    .limit(800);

  // Sin la serie el briefing sigue sirviendo: se loguea y el gráfico cae al
  // historial corto en vez de tumbar toda la respuesta.
  if (errorSerie) console.error("No se pudo cargar la serie del score:", errorSerie);

  return NextResponse.json(
    {
      briefing: latest,
      score_series: series,
      score_diagnostico: diagnostico,
      history: briefings,
      score_history: errorSerie
        ? null
        : (serie ?? []).map((fila) => ({ fecha: fila.briefing_date as string, score: fila.score as number })),
      is_stale:
        latest?.briefing_date !== currentDateInParaguay(),
    },
    { headers: noStoreHeaders() },
  );
}

/**
 * Saca la foto de hoy si falta, arma las series del último año y corrige los
 * briefings cuyo día tiene foto.
 *
 * Cada paso tiene su propio try: que falle la escritura en los briefings no
 * puede tirar las series (la primera versión lo hacía, y el gráfico caía al 0
 * guardado aunque el score estuviera calculado). Todo lo que falla queda en el
 * diagnóstico, que la pantalla muestra cuando no hay score.
 */
async function scoreReal(
  usuarioId: string,
): Promise<{ series: SeriesDeScore | null; diagnostico: DiagnosticoScore }> {
  const admin = adminSinTipos();
  const hoy = hoyEnParaguay();

  let base: Omit<DiagnosticoScore, "filas_historia">;
  try {
    base = await asegurarFotoDeHoy(admin, usuarioId, hoy);
  } catch (error) {
    console.error("No se pudo sacar la foto de indicadores de hoy:", error);
    base = {
      foto_hoy: "no_se_pudo",
      negocio: { habilitado: false, dias: 0, errores: [] },
      personal: { habilitado: false, dias: 0, errores: [] },
      errores: [motivo(error)],
    };
  }
  const diagnostico: DiagnosticoScore = { ...base, filas_historia: 0 };

  let series: SeriesDeScore | null = null;
  try {
    const leido = await leerSeriesDeScore(admin, usuarioId, sumarDias(hoy, -365));
    series = { negocio: leido.negocio, personal: leido.personal };
    diagnostico.filas_historia = leido.filas;
    diagnostico.negocio.dias = leido.negocio.length;
    diagnostico.personal.dias = leido.personal.length;
  } catch (error) {
    console.error("No se pudo leer la historia de indicadores:", error);
    diagnostico.errores.push(`No se pudo leer la historia: ${motivo(error)}`);
    return { series: null, diagnostico };
  }

  try {
    await sincronizarScoreDeBriefings(admin, usuarioId, series);
  } catch (error) {
    console.error("No se pudo escribir el score en los briefings:", error);
    diagnostico.errores.push(`No se pudo guardar el score en el briefing: ${motivo(error)}`);
  }

  return { series, diagnostico };
}

function currentDateInParaguay() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${value.year}-${value.month}-${value.day}`;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  };
}
