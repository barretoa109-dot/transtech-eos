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

  const [briefingResult, contextResult, followupsResult, preferencesResult] = await Promise.all([
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
    supabase
      .from("eos_proactive_followups")
      .select("id,tipo,severidad,titulo,mensaje,programado_para,generado_at,objetivo_id,metadata")
      .eq("usuario_id", user.id)
      .eq("estado", "pendiente")
      .lte("programado_para", new Date().toISOString())
      .order("programado_para", { ascending: true })
      .limit(20),
    supabase
      .from("eos_followup_preferences")
      .select("habilitado,canal_web,zona_horaria,max_alertas_dia,severidad_minima,silencio_desde,silencio_hasta")
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

  if (followupsResult.error) {
    console.error("No se pudieron cargar las alertas proactivas:", followupsResult.error);
  }

  if (preferencesResult.error) {
    console.error("No se pudieron cargar las preferencias proactivas:", preferencesResult.error);
  }

  const briefings = briefingResult.data ?? [];
  const latest = briefings[0] ?? null;
  const dailyLimit = preferencesResult.data?.max_alertas_dia ?? 3;
  const minimumSeverity = normalizeSeverity(preferencesResult.data?.severidad_minima);
  const minimumScore = { media: 40, alta: 70, critica: 90 }[minimumSeverity];
  const attentionItems = (followupsResult.data ?? [])
    .map(rankAttentionItem)
    .filter((item) => item.score >= minimumScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, dailyLimit);
  const proactiveEnabled = preferencesResult.data?.habilitado !== false
    && preferencesResult.data?.canal_web !== false;
  const localHour = hourInTimeZone(preferencesResult.data?.zona_horaria ?? "America/Asuncion");
  const quietHours = isWithinQuietHours(
    localHour,
    preferencesResult.data?.silencio_desde ?? 21,
    preferencesResult.data?.silencio_hasta ?? 7,
  );

  return NextResponse.json(
    {
      briefing: latest,
      history: briefings,
      master_context: contextResult.data ?? null,
      attention: {
        items: proactiveEnabled ? attentionItems : [],
        total_pending: followupsResult.data?.length ?? 0,
        suppressed_count: proactiveEnabled
          ? Math.max(0, (followupsResult.data?.length ?? 0) - attentionItems.length)
          : followupsResult.data?.length ?? 0,
        daily_limit: dailyLimit,
        interruption_recommended:
          proactiveEnabled && !quietHours && attentionItems.some((item) => item.score >= 70),
        quiet_hours: quietHours,
      },
      is_stale:
        latest?.briefing_date !== currentDateInParaguay(),
    },
    { headers: noStoreHeaders() },
  );
}

type FollowupRow = {
  id: string;
  tipo: "objetivo_vencido" | "vence_pronto" | "sin_avance";
  severidad: "media" | "alta" | "critica";
  titulo: string;
  mensaje: string;
  programado_para: string;
  generado_at: string;
  objetivo_id: string;
  metadata: Record<string, unknown> | null;
};

function rankAttentionItem(item: FollowupRow) {
  const severityScore = { media: 45, alta: 70, critica: 90 }[item.severidad] ?? 40;
  const ageInHours = Math.max(
    0,
    (Date.now() - new Date(item.generado_at).getTime()) / 3_600_000,
  );
  const freshnessBonus = Math.max(0, 10 - Math.floor(ageInHours / 12));
  const score = Math.min(100, severityScore + freshnessBonus);
  const reasonByType = {
    objetivo_vencido: "La fecha límite ya pasó y requiere una decisión.",
    vence_pronto: "La fecha límite está próxima y todavía hay margen para actuar.",
    sin_avance: "No hay evidencia reciente de progreso.",
  };

  return {
    id: item.id,
    tipo: item.tipo,
    severidad: item.severidad,
    titulo: item.titulo,
    mensaje: item.mensaje,
    score,
    razon: reasonByType[item.tipo],
    programado_para: item.programado_para,
    objetivo_id: item.objetivo_id,
  };
}

function hourInTimeZone(timeZone: string) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()));
  } catch {
    return hourInTimeZone("America/Asuncion");
  }
}

function isWithinQuietHours(hour: number, startsAt: number, endsAt: number) {
  if (startsAt === endsAt) return false;
  if (startsAt < endsAt) return hour >= startsAt && hour < endsAt;
  return hour >= startsAt || hour < endsAt;
}

function normalizeSeverity(value: unknown): "media" | "alta" | "critica" {
  return value === "alta" || value === "critica" ? value : "media";
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
