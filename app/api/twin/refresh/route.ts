import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_VERSION = "business-twin-v14";
const CONFIDENCE_VERSION = "business-twin-confidence-v1";
const TWIN_TIME_ZONE = "America/Asuncion";

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown, max = 500) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function removeContactFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeContactFields);
  if (!value || typeof value !== "object") return value;

  const blocked = ["whatsapp", "telefono", "teléfono", "phone", "email", "correo"];
  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLocaleLowerCase("es");
    if (blocked.some((blockedKey) => normalized.includes(blockedKey))) continue;
    output[key] = removeContactFields(item);
  }

  return output;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stable((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentDateInTimeZone(timeZone: string, value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calendarDateValue(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : currentDateInTimeZone(TWIN_TIME_ZONE, date);
}

function severityRank(value: unknown) {
  const severity = cleanText(value, 30).toLowerCase();
  if (["critica", "crítica", "critical"].includes(severity)) return 3;
  if (["alta", "high"].includes(severity)) return 2;
  if (["media", "medium"].includes(severity)) return 1;
  return 0;
}

function compactUnknownArray(value: unknown, max = 8) {
  return arrayValue(value).slice(0, max).map((item) => {
    if (typeof item === "string") return cleanText(item, 500);
    return removeContactFields(item);
  });
}

function goalState(goal: Record<string, unknown>, businessDay: string) {
  const progress = Math.round(clamp(numberValue(goal.progreso) / 100) * 100);
  const deadline = calendarDateValue(goal.fecha_limite);
  const overdue = Boolean(deadline && deadline < businessDay && progress < 100);

  return {
    id: goal.id,
    title: cleanText(goal.titulo, 240),
    description: cleanText(goal.descripcion, 500),
    progress,
    status: cleanText(goal.estado, 80),
    priority: numberValue(goal.prioridad, 0),
    measurement_type: cleanText(goal.tipo_medicion, 80),
    current_value: goal.valor_actual ?? null,
    target_value: goal.valor_objetivo ?? null,
    unit: cleanText(goal.unidad, 60),
    success_criterion: cleanText(goal.criterio_exito, 500),
    next_step: cleanText(goal.proximo_paso, 500),
    deadline,
    overdue,
    gap_percent: Math.max(0, 100 - progress),
  };
}

function buildTwin(params: {
  master: Record<string, unknown> | null;
  goals: Record<string, unknown>[];
  followups: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  learnings: Record<string, unknown>[];
  autonomy: Record<string, unknown> | null;
  score: Record<string, unknown> | null;
  businessDay: string;
}) {
  const { master, goals, followups, actions, decisions, learnings, autonomy, score, businessDay } =
    params;

  const goalStates = goals.map((goal) => goalState(goal, businessDay));
  const activeGoals = goalStates.filter(
    (goal) => !["completado", "completed", "cancelado", "cancelled"].includes(goal.status.toLowerCase()),
  );
  const overdueGoals = activeGoals.filter((goal) => goal.overdue);
  const pendingFollowups = followups.filter(
    (item) => !["resuelto", "resolved", "descartado", "dismissed"].includes(
      cleanText(item.estado, 60).toLowerCase(),
    ),
  );
  const failedActions = actions.filter((item) =>
    ["error", "fallida", "failed", "no_disponible"].includes(
      cleanText(item.estado, 60).toLowerCase(),
    ),
  );
  const completedActions = actions.filter((item) =>
    ["completada", "completado", "completed", "done"].includes(
      cleanText(item.estado, 60).toLowerCase(),
    ),
  );
  const measuredDecisions = decisions.filter((item) => numberValue(item.result_count) > 0);

  const gaps = activeGoals
    .map((goal) => ({
      type: goal.overdue ? "overdue_goal" : "goal_gap",
      goal_id: goal.id,
      title: goal.title,
      priority: goal.priority,
      progress: goal.progress,
      gap_percent: goal.gap_percent,
      deadline: goal.deadline,
      next_step: goal.next_step,
      urgency: goal.overdue ? 3 : goal.priority >= 4 ? 2 : goal.gap_percent >= 60 ? 1 : 0,
    }))
    .sort((a, b) => b.urgency - a.urgency || b.priority - a.priority || b.gap_percent - a.gap_percent)
    .slice(0, 10);

  const followupRisks = pendingFollowups
    .map((item) => ({
      source: "followup",
      id: item.id,
      severity: cleanText(item.severidad, 40),
      title: cleanText(item.titulo, 300),
      message: cleanText(item.mensaje, 650),
      scheduled_for: item.programado_para ?? null,
      rank: severityRank(item.severidad),
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 8);

  const learningRisks = learnings
    .filter((item) => ["weakening", "contradictory"].includes(cleanText(item.longitudinal_state, 40)))
    .map((item) => ({
      source: "learning",
      type: cleanText(item.longitudinal_state, 40),
      pattern: cleanText(item.patron, 500),
      recommendation: cleanText(item.recomendacion, 500),
      confidence: numberValue(item.confianza),
      evidence_count: numberValue(item.evidence_count),
    }));

  const capabilities = learnings
    .filter((item) =>
      ["strengthening", "stable"].includes(cleanText(item.longitudinal_state, 40)) &&
      numberValue(item.confianza) >= 0.65 &&
      numberValue(item.evidence_count) >= 3,
    )
    .slice(0, 8)
    .map((item) => ({
      category: cleanText(item.categoria, 80),
      pattern: cleanText(item.patron, 500),
      recommendation: cleanText(item.recomendacion, 500),
      confidence: numberValue(item.confianza),
      evidence_count: numberValue(item.evidence_count),
      state: cleanText(item.longitudinal_state, 40),
    }));

  const opportunities = activeGoals
    .filter((goal) => !goal.overdue && (goal.priority >= 3 || goal.progress >= 50))
    .sort((a, b) => b.priority - a.priority || b.progress - a.progress)
    .slice(0, 6)
    .map((goal) => ({
      source: "goal",
      goal_id: goal.id,
      title: goal.title,
      progress: goal.progress,
      priority: goal.priority,
      next_step: goal.next_step,
      rationale:
        goal.progress >= 50
          ? "Objetivo con tracción verificable y margen para capturar valor."
          : "Objetivo prioritario que merece concentración de recursos.",
    }));

  const priorities = gaps.slice(0, 3).map((gap, index) => ({
    rank: index + 1,
    source: "goal",
    title: gap.title,
    reason: gap.type === "overdue_goal"
      ? "Objetivo vencido que sigue abierto."
      : gap.priority >= 4
        ? "Objetivo de prioridad alta con brecha relevante."
        : "Brecha relevante respecto al estado deseado.",
    next_step: gap.next_step,
    goal_id: gap.goal_id,
  }));

  if (priorities.length < 3) {
    for (const risk of followupRisks) {
      if (priorities.length >= 3) break;
      priorities.push({
        rank: priorities.length + 1,
        source: "followup",
        title: risk.title,
        reason: `Seguimiento pendiente de severidad ${risk.severity || "no definida"}.`,
        next_step: risk.message,
        goal_id: null,
      });
    }
  }

  const masterState = objectValue(master?.estado_actual);
  const masterIdentity = objectValue(master?.identidad);
  const commitments = compactUnknownArray(master?.compromisos, 8);
  const alerts = compactUnknownArray(master?.alertas, 8);

  const sourcePresence = {
    master_context: Boolean(master),
    goals: goals.length > 0,
    decisions: decisions.length > 0,
    actions: actions.length > 0,
    learnings: learnings.length > 0,
    autonomy: Boolean(autonomy),
    intelligence_score: Boolean(score),
  };
  const weights = {
    master_context: 0.25,
    goals: 0.25,
    decisions: 0.12,
    actions: 0.12,
    learnings: 0.12,
    autonomy: 0.07,
    intelligence_score: 0.07,
  };
  const sourceCompleteness = Object.entries(weights).reduce(
    (total, [key, weight]) =>
      total + (sourcePresence[key as keyof typeof sourcePresence] ? weight : 0),
    0,
  );
  const masterStale = Boolean(master?.necesita_actualizacion);
  const confidence = clamp(sourceCompleteness * (masterStale ? 0.85 : 1));

  return {
    identity: removeContactFields(masterIdentity),
    current_state: {
      ...removeContactFields(masterState) as Record<string, unknown>,
      active_goals: activeGoals.length,
      overdue_goals: overdueGoals.length,
      pending_followups: pendingFollowups.length,
      actions_30d: actions.length,
      completed_actions_30d: completedActions.length,
      failed_actions_30d: failedActions.length,
      recent_decisions: decisions.length,
      measured_decisions: measuredDecisions.length,
    },
    desired_state: {
      goals: activeGoals.slice(0, 12),
      master_goals: compactUnknownArray(master?.objetivos, 8),
    },
    gaps,
    constraints: [
      ...commitments.map((item) => ({ source: "commitment", detail: item })),
      ...alerts.map((item) => ({ source: "master_alert", detail: item })),
      ...followupRisks.slice(0, 5),
    ].slice(0, 15),
    capabilities,
    risks: [
      ...followupRisks,
      ...learningRisks,
      ...failedActions.slice(0, 5).map((item) => ({
        source: "action",
        action: cleanText(item.accion, 80),
        error_code: cleanText(item.error_code, 120),
        error_message: cleanText(item.error_message, 500),
        created_at: item.created_at ?? null,
      })),
      ...overdueGoals.slice(0, 5).map((goal) => ({
        source: "goal",
        type: "overdue",
        goal_id: goal.id,
        title: goal.title,
        progress: goal.progress,
        deadline: goal.deadline,
      })),
    ].slice(0, 20),
    opportunities,
    priorities,
    execution_profile: {
      window_days: 30,
      total_actions: actions.length,
      completed: completedActions.length,
      failed: failedActions.length,
      completion_rate:
        actions.length > 0 ? Number((completedActions.length / actions.length).toFixed(3)) : null,
    },
    learning_profile: {
      total_considered: learnings.length,
      strengthening: learnings.filter((item) => cleanText(item.longitudinal_state, 40) === "strengthening").length,
      stable: learnings.filter((item) => cleanText(item.longitudinal_state, 40) === "stable").length,
      weakening: learnings.filter((item) => cleanText(item.longitudinal_state, 40) === "weakening").length,
      contradictory: learnings.filter((item) => cleanText(item.longitudinal_state, 40) === "contradictory").length,
    },
    autonomy_profile: autonomy
      ? {
          enabled: Boolean(autonomy.enabled),
          default_level: numberValue(autonomy.default_level, 1),
          max_auto_actions_per_day: numberValue(autonomy.max_auto_actions_per_day, 5),
          max_daily_risk_points: numberValue(autonomy.max_daily_risk_points, 10),
        }
      : {},
    intelligence_score: score ? Math.round(numberValue(score.score)) : null,
    confidence: Number(confidence.toFixed(3)),
    source_completeness: Number(sourceCompleteness.toFixed(3)),
    source_presence: sourcePresence,
  };
}

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Sesión no válida." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const { data: sourceRevisionRaw, error: sourceRevisionError } = await supabase.rpc(
      "eos_get_business_twin_source_revision_v34",
    );
    const sourceRevision = Number(sourceRevisionRaw);

    if (
      sourceRevisionError ||
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision < 0
    ) {
      console.error(
        "No se pudo iniciar el refresh seguro del Business Twin:",
        sourceRevisionError || "EOS_TWIN_SOURCE_REVISION_INVALID",
      );
      return NextResponse.json(
        { error: "No pudimos iniciar la actualización segura de tu Twin." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [masterResult, goalsResult, followupsResult, actionsResult, decisionsResult, learningsResult, autonomyResult, scoreResult] =
      await Promise.all([
        supabase
          .from("eos_master_context_v8")
          .select("version,identidad,estado_actual,objetivos,compromisos,alertas,proxima_mejor_accion,source_fingerprint,generado_at,necesita_actualizacion")
          .eq("usuario_id", user.id)
          .maybeSingle(),
        supabase
          .from("eos_goals")
          .select("id,titulo,descripcion,progreso,estado,tipo_medicion,valor_actual,valor_objetivo,unidad,prioridad,criterio_exito,proximo_paso,fecha_limite,ultima_actualizacion_at,updated_at")
          .eq("usuario_id", user.id)
          .order("prioridad", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(50),
        supabase
          .from("eos_proactive_followups")
          .select("id,objetivo_id,tipo,severidad,titulo,mensaje,estado,programado_para,generado_at,updated_at")
          .eq("usuario_id", user.id)
          .order("generado_at", { ascending: false })
          .limit(50),
        supabase
          .from("eos_action_commands")
          .select("id,accion,estado,error_code,error_message,completed_at,created_at,updated_at")
          .eq("usuario_id", user.id)
          .gte("created_at", since30d)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("eos_decision_registry_v6")
          .select("id,titulo,decision,estado,confianza,fecha_decision,fecha_revision,result_count,latest_result_type,latest_result_summary,latest_learning,updated_at")
          .eq("usuario_id", user.id)
          .order("fecha_decision", { ascending: false })
          .limit(30),
        supabase
          .from("eos_learning_longitudinal_v13")
          .select("id,categoria,patron,recomendacion,confianza,evidence_count,positive_count,negative_count,longitudinal_state,last_observed_at,updated_at")
          .eq("usuario_id", user.id)
          .neq("longitudinal_state", "stale")
          .order("confianza", { ascending: false })
          .limit(20),
        supabase
          .from("eos_autonomy_profiles_v12")
          .select("default_level,max_auto_actions_per_day,max_daily_risk_points,approval_ttl_minutes,enabled,updated_at")
          .eq("usuario_id", user.id)
          .maybeSingle(),
        supabase
          .from("eos_intelligence_score_snapshots_v10")
          .select("score,snapshot_day,formula_version,calculated_at")
          .eq("usuario_id", user.id)
          .order("snapshot_day", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const sourceErrors = [
      masterResult.error,
      goalsResult.error,
      followupsResult.error,
      actionsResult.error,
      decisionsResult.error,
      learningsResult.error,
      autonomyResult.error,
      scoreResult.error,
    ].filter(Boolean);

    if (sourceErrors.length > 0) {
      console.error("No se pudieron leer fuentes del Business Twin:", sourceErrors);
      return NextResponse.json(
        { error: "No pudimos reunir las fuentes necesarias para actualizar tu Twin." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    const master = masterResult.data as Record<string, unknown> | null;
    const goals = (goalsResult.data || []) as Record<string, unknown>[];
    const followups = (followupsResult.data || []) as Record<string, unknown>[];
    const actions = (actionsResult.data || []) as Record<string, unknown>[];
    const decisions = (decisionsResult.data || []) as Record<string, unknown>[];
    const learnings = (learningsResult.data || []) as Record<string, unknown>[];
    const autonomy = autonomyResult.data as Record<string, unknown> | null;
    const score = scoreResult.data as Record<string, unknown> | null;

    const businessDay = currentDateInTimeZone(TWIN_TIME_ZONE);
    const derived = buildTwin({
      master,
      goals,
      followups,
      actions,
      decisions,
      learnings,
      autonomy,
      score,
      businessDay,
    });
    const sourceFingerprint = fingerprint({
      model_version: MODEL_VERSION,
      confidence_version: CONFIDENCE_VERSION,
      derived,
    });
    const metadata = {
      confidence_version: CONFIDENCE_VERSION,
      source_presence: derived.source_presence,
      source_descriptor: {
        business_day: businessDay,
        master_context_version: master?.version ?? null,
        goals: goals.length,
        followups: followups.length,
        actions_30d: actions.length,
        decisions: decisions.length,
        learnings: learnings.length,
        autonomy: Boolean(autonomy),
        intelligence_score: Boolean(score),
      },
    };

    const { data: commitResult, error: commitError } = await supabase.rpc(
      "eos_commit_business_twin_v34",
      {
        p_source_revision: sourceRevision,
        p_model_version: MODEL_VERSION,
        p_source_fingerprint: sourceFingerprint,
        p_identity: derived.identity,
        p_current_state: derived.current_state,
        p_desired_state: derived.desired_state,
        p_gaps: derived.gaps,
        p_constraints: derived.constraints,
        p_capabilities: derived.capabilities,
        p_risks: derived.risks,
        p_opportunities: derived.opportunities,
        p_priorities: derived.priorities,
        p_execution_profile: derived.execution_profile,
        p_learning_profile: derived.learning_profile,
        p_autonomy_profile: derived.autonomy_profile,
        p_intelligence_score: derived.intelligence_score,
        p_confidence: derived.confidence,
        p_source_completeness: derived.source_completeness,
        p_metadata: metadata,
      },
    );

    if (commitError) {
      if (commitError.message?.includes("EOS_TWIN_SOURCE_CHANGED")) {
        console.warn(
          "Business Twin no comprometido porque una fuente cambió durante el refresh.",
          { sourceRevision },
        );
        return NextResponse.json(
          {
            error: "Los datos cambiaron mientras EOS actualizaba tu Twin. Volvé a intentarlo.",
            retryable: true,
          },
          { status: 409, headers: noStoreHeaders() },
        );
      }

      console.error("No se pudo guardar Business Twin de forma atómica:", commitError);
      return NextResponse.json(
        { error: "No pudimos guardar la nueva versión de tu Twin." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    if (!commitResult || typeof commitResult !== "object" || Array.isArray(commitResult)) {
      console.error("Commit del Business Twin devolvió una respuesta inválida.");
      return NextResponse.json(
        { error: "No pudimos confirmar la nueva versión de tu Twin." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    const committed = commitResult as {
      twin?: unknown;
      changed?: boolean;
      refreshed?: boolean;
      source_revision?: number;
      stale?: boolean;
    };
    const saved = objectValue(committed.twin);

    if (!saved.usuario_id) {
      console.error("Commit del Business Twin no devolvió un Twin válido.", commitResult);
      return NextResponse.json(
        { error: "No pudimos confirmar la nueva versión de tu Twin." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    const changed = Boolean(committed.changed);
    return NextResponse.json(
      {
        ok: true,
        changed,
        refreshed: Boolean(committed.refreshed),
        source_revision: committed.source_revision ?? sourceRevision,
        twin: {
          ...saved,
          is_stale: Boolean(committed.stale),
          age_minutes: 0,
        },
        ...(changed
          ? {}
          : { reason: "Las fuentes operativas no cambiaron desde la última versión." }),
      },
      { status: changed ? 201 : 200, headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error("Error actualizando Business Twin:", error);
    return NextResponse.json(
      { error: "No se pudo actualizar el Business Twin." },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
