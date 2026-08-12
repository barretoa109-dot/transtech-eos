import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BRIEFING_COLUMNS =
  "id,briefing_date,estado,tipo_usuario,saludo,titulo_dia,resumen,enfoque_dia,prioridad_1,prioridad_2,prioridad_3,recomendacion_principal,logros,riesgos,proximos_pasos,fuentes,score,modelo_version,generated_at,created_at,updated_at" as const;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      {
        status: 401,
        headers: noStoreHeaders(),
      },
    );
  }

  const [briefingResult, contextResult] = await Promise.all([
    supabase
      .from("eos_daily_briefings")
      .select(BRIEFING_COLUMNS)
      .eq("usuario_id", user.id)
      .not("briefing_date", "is", null)
      .eq("estado", "listo")
      .order("briefing_date", { ascending: false })
      .order("generated_at", { ascending: false })
      .limit(7),
    supabase
      .from("eos_master_context_v8")
      .select("resumen_compacto,proxima_mejor_accion,alertas,objetivos,necesita_actualizacion,generado_at")
      .eq("usuario_id", user.id)
      .maybeSingle(),
  ]);

  if (briefingResult.error) {
    console.error("No se pudo cargar el briefing diario:", briefingResult.error);
    return NextResponse.json(
      { error: "No pudimos cargar tu briefing en este momento." },
      {
        status: 500,
        headers: noStoreHeaders(),
      },
    );
  }

  if (contextResult.error) {
    console.error("No se pudo cargar el Contexto Maestro para el briefing:", contextResult.error);
  }

  const briefings = briefingResult.data ?? [];
  const latest = briefings[0] ?? null;

  return NextResponse.json(
    {
      briefing: latest,
      history: briefings,
      master_context: contextResult.data ?? null,
      is_stale:
        latest?.briefing_date !== currentDateInParaguay(),
    },
    { headers: noStoreHeaders() },
  );
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
