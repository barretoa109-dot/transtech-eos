import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { DIMENSIONES } from "@/lib/kpi/score";
import { CON_UMBRALES } from "@/lib/kpi/registro";
import { DIMENSIONES_PERSONALES, CON_UMBRALES_PERSONALES } from "@/lib/finanzas/pulso";
import { scoresPorDia, type FilaHistoriaScore } from "@/lib/kpi/scoreDiario";

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

  const series = await seriesDeScore(user.id);

  return NextResponse.json(
    {
      briefing: latest,
      score_series: series,
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

/** Filas por página: el techo que PostgREST aplica por defecto a cada respuesta. */
const PAGINA = 1000;
/** Techo de páginas: ~30 indicadores por día durante un año entran holgados. */
const MAX_PAGINAS = 15;

/**
 * El score del negocio y el personal de cada día del último año, rearmados
 * desde la foto diaria de los indicadores (ver `lib/kpi/scoreDiario.ts`).
 *
 * Van separados y no promediados: son dos preguntas distintas —¿cómo está el
 * negocio?, ¿cómo estoy yo?— y la v136 separó sus datos a propósito.
 *
 * null si la lectura falla: el gráfico cae entonces al score de los briefings
 * en vez de mostrar una serie vacía que se leería como "no hay historia".
 */
async function seriesDeScore(
  usuarioId: string,
): Promise<{ negocio: { fecha: string; score: number }[]; personal: { fecha: string; score: number }[] } | null> {
  const ids = [...DIMENSIONES, ...DIMENSIONES_PERSONALES].flatMap((d) => d.indicadores);
  const desde = sumarDias(hoyEnParaguay(), -365);
  const filas: FilaHistoriaScore[] = [];

  try {
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      /*
       * Cliente admin filtrado a mano por el usuario de la sesión, igual que
       * `GET /api/kpi/historia`: service_role no pasa por RLS, así que este
       * `.eq("usuario_id")` es el candado que no se puede olvidar.
       */
      const { data, error } = await adminSinTipos()
        .from("eos_kpi_historia_v105")
        .select("indicador,moneda,fecha,estado,confianza")
        .eq("usuario_id", usuarioId)
        .in("indicador", ids)
        .gte("fecha", desde)
        .order("fecha", { ascending: true })
        .order("indicador", { ascending: true })
        .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);

      if (error) throw error;

      const lote = (data ?? []) as Record<string, unknown>[];
      for (const f of lote) {
        filas.push({
          indicador: String(f.indicador),
          moneda: String(f.moneda),
          fecha: String(f.fecha),
          estado: (f.estado as FilaHistoriaScore["estado"]) ?? null,
          confianza: f.confianza === null || f.confianza === undefined ? null : Number(f.confianza),
        });
      }
      if (lote.length < PAGINA) break;
    }
  } catch (error) {
    console.error("No se pudo leer la historia de indicadores para el score:", error);
    return null;
  }

  return {
    negocio: scoresPorDia(filas, DIMENSIONES, CON_UMBRALES),
    personal: scoresPorDia(filas, DIMENSIONES_PERSONALES, CON_UMBRALES_PERSONALES),
  };
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
