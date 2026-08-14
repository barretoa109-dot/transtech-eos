import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FORMULA_VERSION = "eos-intelligence-score-v1";
const SCORE_TIME_ZONE = "America/Asuncion";

type Dimensions = {
  contexto: number;
  objetivos: number;
  ejecucion: number;
  decisiones: number;
  aprendizaje: number;
};

type Signals = {
  active_goals: number;
  pending_alerts: number;
  critical_alerts: number;
  completed_actions: number;
  measured_decisions: number;
  learning_evidence: number;
};

type Snapshot = {
  snapshot_day: string;
  score: number;
  contexto: number;
  objetivos: number;
  ejecucion: number;
  decisiones: number;
  aprendizaje: number;
  active_goals: number;
  pending_alerts: number;
  critical_alerts: number;
  completed_actions: number;
  measured_decisions: number;
  learning_evidence: number;
  formula_version: string;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  const [goals, followups, actions, decisions, learnings, context, history] = await Promise.all([
    supabase.from("eos_goals").select("progreso,estado").eq("usuario_id", user.id),
    supabase.from("eos_proactive_followups").select("severidad,estado").eq("usuario_id", user.id).in("estado", ["pendiente", "visto"]),
    supabase.from("eos_action_commands").select("estado").eq("usuario_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("eos_decision_registry_v6").select("estado,result_count").eq("usuario_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("eos_learnings").select("confianza,evidence_count,estado").eq("usuario_id", user.id).eq("estado", "activo").order("updated_at", { ascending: false }).limit(100),
    supabase.from("eos_master_context_v8").select("identidad,estado_actual,objetivos,proyectos,compromisos,necesita_actualizacion").eq("usuario_id", user.id).maybeSingle(),
    supabase
      .from("eos_intelligence_score_snapshots_v10")
      .select("snapshot_day,score,contexto,objetivos,ejecucion,decisiones,aprendizaje,active_goals,pending_alerts,critical_alerts,completed_actions,measured_decisions,learning_evidence,formula_version")
      .eq("usuario_id", user.id)
      .order("snapshot_day", { ascending: false })
      .limit(30),
  ]);

  const queryError = [goals.error, followups.error, actions.error, decisions.error, learnings.error, context.error].find(Boolean);
  if (queryError) {
    console.error("No se pudo calcular EOS Intelligence Score:", queryError);
    return NextResponse.json({ error: "No pudimos calcular tu EOS Score." }, { status: 500 });
  }

  if (history.error) {
    console.error("No se pudo cargar el historial del EOS Intelligence Score:", history.error);
  }

  const activeGoals = (goals.data ?? []).filter((item) => item.estado === "activo");
  const completedActions = (actions.data ?? []).filter((item) => item.estado === "completada").length;
  const failedActions = (actions.data ?? []).filter((item) => item.estado === "error").length;
  const measuredDecisions = (decisions.data ?? []).filter((item) => Number(item.result_count) > 0).length;
  const totalDecisions = decisions.data?.length ?? 0;
  const evidenceCount = (learnings.data ?? []).reduce((sum, item) => sum + Number(item.evidence_count ?? 0), 0);
  const criticalAlerts = (followups.data ?? []).filter((item) => item.severidad === "critica").length;

  const dimensions: Dimensions = {
    contexto: clamp((context.data ? 78 : 20) + (context.data?.necesita_actualizacion ? -18 : 12)),
    objetivos: clamp(activeGoals.length
      ? average(activeGoals.map((item) => Number(item.progreso ?? 0)))
      : 25),
    ejecucion: clamp(actions.data?.length
      ? 45 + completedActions * 8 - failedActions * 12
      : 30),
    decisiones: clamp(totalDecisions
      ? 35 + (measuredDecisions / totalDecisions) * 65
      : 25),
    aprendizaje: clamp(20 + evidenceCount * 5 + (learnings.data?.length ?? 0) * 6),
  };

  const score = clamp(
    dimensions.contexto * 0.2
      + dimensions.objetivos * 0.25
      + dimensions.ejecucion * 0.25
      + dimensions.decisiones * 0.15
      + dimensions.aprendizaje * 0.15
      - criticalAlerts * 3,
  );

  const signals: Signals = {
    active_goals: activeGoals.length,
    pending_alerts: followups.data?.length ?? 0,
    critical_alerts: criticalAlerts,
    completed_actions: completedActions,
    measured_decisions: measuredDecisions,
    learning_evidence: evidenceCount,
  };

  const weakest = Object.entries(dimensions).sort(([, left], [, right]) => left - right)[0];
  const strongest = Object.entries(dimensions).sort(([, left], [, right]) => right - left)[0];
  const snapshots = (history.data ?? []) as Snapshot[];
  const today = currentDateInTimeZone(SCORE_TIME_ZONE);
  const comparison = snapshots.find((item) => item.snapshot_day !== today && item.formula_version === FORMULA_VERSION) ?? null;
  const trend = buildTrend(score, dimensions, signals, comparison);

  let snapshotError: unknown = null;
  let persistedCalculatedAt: string | null = null;
  try {
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("eos_intelligence_score_snapshots_v10")
      .upsert({
        usuario_id: user.id,
        snapshot_day: today,
        score,
        contexto: dimensions.contexto,
        objetivos: dimensions.objetivos,
        ejecucion: dimensions.ejecucion,
        decisiones: dimensions.decisiones,
        aprendizaje: dimensions.aprendizaje,
        active_goals: signals.active_goals,
        pending_alerts: signals.pending_alerts,
        critical_alerts: signals.critical_alerts,
        completed_actions: signals.completed_actions,
        measured_decisions: signals.measured_decisions,
        learning_evidence: signals.learning_evidence,
        strongest_dimension: strongest[0],
        weakest_dimension: weakest[0],
        formula_version: FORMULA_VERSION,
        calculated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "usuario_id,snapshot_day" })
      .select("calculated_at")
      .maybeSingle();
    snapshotError = error;
    persistedCalculatedAt = typeof data?.calculated_at === "string"
      ? data.calculated_at
      : null;
  } catch (error) {
    snapshotError = error;
  }

  if (snapshotError) {
    console.error("No se pudo persistir el EOS Intelligence Score:", snapshotError);
  }

  const comparableHistory = snapshots
    .filter((item) => item.formula_version === FORMULA_VERSION);
  const historyForResponse = snapshotError
    ? comparableHistory
    : [
        ...comparableHistory.filter((item) => item.snapshot_day !== today),
        {
          snapshot_day: today,
          score,
          formula_version: FORMULA_VERSION,
        } as Snapshot,
      ];

  return NextResponse.json({
    score,
    dimensions,
    explanation: {
      strongest: { dimension: strongest[0], score: strongest[1] },
      weakest: { dimension: weakest[0], score: weakest[1] },
      summary: `Tu dimensión más sólida es ${label(strongest[0])}. La mayor oportunidad está en ${label(weakest[0])}.`,
      next_action: nextAction(weakest[0]),
    },
    trend,
    signals,
    history: historyForResponse
      .sort((left, right) => right.snapshot_day.localeCompare(left.snapshot_day))
      .slice(0, 14)
      .map((item) => ({ day: item.snapshot_day, score: item.score }))
      .reverse(),
    persistence: {
      snapshot_persisted: !snapshotError,
      history_loaded: !history.error,
      writer: "server",
    },
    formula_version: FORMULA_VERSION,
    calculated_at: persistedCalculatedAt ?? new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
}

function buildTrend(score: number, dimensions: Dimensions, signals: Signals, previous: Snapshot | null) {
  if (!previous) {
    return {
      direction: "new",
      delta: 0,
      summary: "Este es tu primer punto de referencia comparable. Desde ahora EOS podrá explicar cómo evoluciona tu score.",
      drivers: [] as Array<{ key: string; label: string; delta: number; impact: "positivo" | "negativo" }>,
      previous_day: null,
      previous_score: null,
    };
  }

  const delta = score - previous.score;
  const dimensionDrivers = (Object.keys(dimensions) as Array<keyof Dimensions>)
    .map((key) => ({
      key,
      label: label(key),
      delta: dimensions[key] - Number(previous[key]),
    }))
    .filter((item) => item.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 3)
    .map((item) => ({ ...item, impact: item.delta > 0 ? "positivo" as const : "negativo" as const }));

  const signalDrivers = [
    signalDriver("critical_alerts", "Alertas críticas", previous.critical_alerts, signals.critical_alerts, true),
    signalDriver("completed_actions", "Acciones completadas", previous.completed_actions, signals.completed_actions),
    signalDriver("measured_decisions", "Decisiones medidas", previous.measured_decisions, signals.measured_decisions),
    signalDriver("learning_evidence", "Evidencia de aprendizaje", previous.learning_evidence, signals.learning_evidence),
  ].filter(Boolean) as Array<{ key: string; label: string; delta: number; impact: "positivo" | "negativo" }>;

  const drivers = [...dimensionDrivers, ...signalDrivers]
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 4);

  return {
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "stable",
    delta,
    summary: trendSummary(delta, drivers),
    drivers,
    previous_day: previous.snapshot_day,
    previous_score: previous.score,
  };
}

function signalDriver(
  key: string,
  labelValue: string,
  previous: number,
  current: number,
  inverse = false,
) {
  const delta = current - previous;
  if (delta === 0) return null;
  const positive = inverse ? delta < 0 : delta > 0;
  return {
    key,
    label: labelValue,
    delta,
    impact: positive ? "positivo" as const : "negativo" as const,
  };
}

function trendSummary(
  delta: number,
  drivers: Array<{ label: string; delta: number; impact: "positivo" | "negativo" }>,
) {
  const direction = delta > 0 ? `subió ${delta} puntos` : delta < 0 ? `bajó ${Math.abs(delta)} puntos` : "se mantuvo estable";
  const main = drivers[0];
  if (!main) return `Tu EOS Intelligence Score ${direction} desde la última medición comparable.`;
  const movement = main.delta > 0 ? `mejoró ${Math.abs(main.delta)}` : `cambió ${Math.abs(main.delta)}`;
  return `Tu EOS Intelligence Score ${direction}. El principal factor fue ${main.label}, que ${movement}.`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function label(value: string) {
  return ({ contexto: "Contexto", objetivos: "Objetivos", ejecucion: "Ejecución", decisiones: "Decisiones", aprendizaje: "Aprendizaje" } as Record<string, string>)[value] ?? value;
}

function nextAction(dimension: string) {
  return ({
    contexto: "Completá el estado actual y la prioridad principal de tu empresa.",
    objetivos: "Actualizá la evidencia y el próximo paso del objetivo prioritario.",
    ejecucion: "Cerrá o reintentá la acción pendiente de mayor impacto.",
    decisiones: "Registrá el resultado real de una decisión que ya debía medirse.",
    aprendizaje: "Reuní al menos tres resultados comparables para validar un patrón.",
  } as Record<string, string>)[dimension] ?? "Revisá la próxima mejor acción de tu Contexto Maestro.";
}

function currentDateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
