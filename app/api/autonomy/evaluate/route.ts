import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SystemRisk = { tier: number; points: number; maxLevel: number };
type Decision = "recommend" | "prepare" | "approval" | "allow" | "block";

const SYSTEM_RISK: Record<string, SystemRisk> = {
  RESPONDER: { tier: 0, points: 0, maxLevel: 3 },
  VER_DASHBOARD: { tier: 0, points: 0, maxLevel: 3 },
  VER_BRIEFING: { tier: 0, points: 0, maxLevel: 3 },
  GUARDAR_MEMORIA: { tier: 1, points: 1, maxLevel: 3 },
  GENERAR_EXCEL: { tier: 1, points: 1, maxLevel: 3 },
  GENERAR_PDF: { tier: 1, points: 1, maxLevel: 3 },
  GENERAR_WORD: { tier: 1, points: 1, maxLevel: 3 },
  CREAR_TAREA: { tier: 1, points: 2, maxLevel: 3 },
  CREAR_OBJETIVO: { tier: 2, points: 4, maxLevel: 2 },
};

const DEFAULT_PROFILE = {
  default_level: 1,
  max_auto_actions_per_day: 5,
  max_daily_risk_points: 10,
  approval_ttl_minutes: 60,
  enabled: true,
};

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableFingerprint(value: Record<string, unknown>) {
  const sorted = Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function responseBody(params: {
  requestId: string;
  action: string;
  decision: Decision;
  reason: string;
  configuredLevel: number;
  effectiveLevel: number;
  systemRisk: SystemRisk;
  riskTier: number;
  riskPoints: number;
  autoCount: number;
  actionLimit: number;
  usedRisk: number;
  riskLimit: number;
  approval?: unknown;
  idempotent?: boolean;
}) {
  return {
    ok: true,
    request_id: params.requestId,
    accion: params.action,
    decision: params.decision,
    reason: params.reason,
    configured_level: params.configuredLevel,
    effective_level: params.effectiveLevel,
    system_risk: params.systemRisk,
    effective_risk: { tier: params.riskTier, points: params.riskPoints },
    daily_limits: {
      auto_count: params.autoCount,
      auto_limit: params.actionLimit,
      risk_used: params.usedRisk,
      risk_limit: params.riskLimit,
    },
    approval: params.approval || null,
    idempotent: params.idempotent || false,
  };
}

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const action = typeof body?.accion === "string" ? body.accion.trim() : "";
  const systemRisk = SYSTEM_RISK[action];

  if (!systemRisk) {
    return NextResponse.json(
      { error: "La acción no pertenece al catálogo gobernado por EOS." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const requestId =
    typeof body?.request_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id)
      ? body.request_id
      : crypto.randomUUID();
  const payload = safeObject(body?.payload);

  const [profileResult, ruleResult, dailyEventsResult, existingApprovalResult] =
    await Promise.all([
      supabase
        .from("eos_autonomy_profiles_v12")
        .select("default_level,max_auto_actions_per_day,max_daily_risk_points,approval_ttl_minutes,enabled")
        .eq("usuario_id", user.id)
        .maybeSingle(),
      supabase
        .from("eos_autonomy_rules_v12")
        .select("autonomy_level,risk_tier,risk_points,max_auto_per_day,enabled,require_fresh_context")
        .eq("usuario_id", user.id)
        .eq("accion", action)
        .maybeSingle(),
      supabase
        .from("eos_autonomy_events_v12")
        .select("event_type,detail")
        .eq("usuario_id", user.id)
        .eq("event_type", "auto_allowed")
        .gte("created_at", startOfUtcDay()),
      supabase
        .from("eos_action_approvals_v12")
        .select("id,request_id,accion,status,risk_tier,risk_points,requested_level,effective_level,reason,expires_at,created_at,decided_at")
        .eq("usuario_id", user.id)
        .eq("request_id", requestId)
        .eq("accion", action)
        .maybeSingle(),
    ]);

  const readError =
    profileResult.error ||
    ruleResult.error ||
    dailyEventsResult.error ||
    existingApprovalResult.error;
  if (readError) {
    console.error("No se pudo evaluar autonomía EOS:", readError);
    return NextResponse.json(
      { error: "No pudimos evaluar la política de autonomía." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  const profile = { ...DEFAULT_PROFILE, ...(profileResult.data || {}) };
  const rule = ruleResult.data;
  const configuredLevel =
    rule?.enabled === false ? 0 : Number(rule?.autonomy_level ?? profile.default_level);
  const effectiveLevel = Math.min(configuredLevel, systemRisk.maxLevel);
  const riskTier = Math.max(systemRisk.tier, Number(rule?.risk_tier ?? 0));
  const riskPoints = Math.max(systemRisk.points, Number(rule?.risk_points ?? 0));
  const autoEvents = dailyEventsResult.data || [];
  const autoCount = autoEvents.length;
  const usedRisk = autoEvents.reduce((total, event) => {
    const detail = safeObject(event.detail);
    const value = Number(detail.risk_points || 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  const actionLimit =
    rule?.max_auto_per_day === null || rule?.max_auto_per_day === undefined
      ? profile.max_auto_actions_per_day
      : Math.min(profile.max_auto_actions_per_day, Number(rule.max_auto_per_day));

  const existingApproval = existingApprovalResult.data;
  if (existingApproval) {
    let decision: Decision = "approval";
    let reason = existingApproval.reason || "La acción requiere aprobación explícita.";

    if (existingApproval.status === "approved") {
      decision = "allow";
      reason = "La acción ya fue aprobada explícitamente para este request.";
    } else if (
      existingApproval.status === "rejected" ||
      existingApproval.status === "expired" ||
      existingApproval.status === "cancelled"
    ) {
      decision = "block";
      reason = `La aprobación está en estado ${existingApproval.status}.`;
    } else if (existingApproval.status === "consumed") {
      decision = "block";
      reason = "La aprobación ya fue consumida por una ejecución anterior.";
    } else if (new Date(existingApproval.expires_at).getTime() <= Date.now()) {
      decision = "block";
      reason = "La aprobación asociada a este request ya venció.";
    }

    return NextResponse.json(
      responseBody({
        requestId,
        action,
        decision,
        reason,
        configuredLevel,
        effectiveLevel,
        systemRisk,
        riskTier,
        riskPoints,
        autoCount,
        actionLimit,
        usedRisk,
        riskLimit: profile.max_daily_risk_points,
        approval: existingApproval,
        idempotent: true,
      }),
      { headers: noStoreHeaders() },
    );
  }

  const { data: priorEvents, error: priorEventError } = await supabase
    .from("eos_autonomy_events_v12")
    .select("event_type,detail,created_at")
    .eq("usuario_id", user.id)
    .contains("detail", { request_id: requestId, accion: action })
    .order("created_at", { ascending: false })
    .limit(1);

  if (priorEventError) {
    console.error("No se pudo comprobar idempotencia de autonomía:", priorEventError);
  } else if (priorEvents?.length) {
    const detail = safeObject(priorEvents[0].detail);
    const previousDecision = detail.decision;
    if (
      previousDecision === "recommend" ||
      previousDecision === "prepare" ||
      previousDecision === "allow" ||
      previousDecision === "block"
    ) {
      return NextResponse.json(
        responseBody({
          requestId,
          action,
          decision: previousDecision,
          reason: String(detail.reason || "Evaluación reutilizada."),
          configuredLevel: Number(detail.configured_level ?? configuredLevel),
          effectiveLevel: Number(detail.effective_level ?? effectiveLevel),
          systemRisk,
          riskTier: Number(detail.risk_tier ?? riskTier),
          riskPoints: Number(detail.risk_points ?? riskPoints),
          autoCount,
          actionLimit,
          usedRisk,
          riskLimit: profile.max_daily_risk_points,
          idempotent: true,
        }),
        { headers: noStoreHeaders() },
      );
    }
  }

  let decision: Decision;
  let reason = "";

  if (!profile.enabled) {
    decision = "recommend";
    reason = "La autonomía está desactivada para este usuario.";
  } else if (effectiveLevel <= 0) {
    decision = "recommend";
    reason = "La política permite únicamente recomendar esta acción.";
  } else if (effectiveLevel === 1) {
    decision = "prepare";
    reason = "EOS puede preparar la acción, pero no ejecutarla.";
  } else if (effectiveLevel === 2 || riskTier >= 2) {
    decision = "approval";
    reason =
      riskTier >= 2
        ? "El riesgo mínimo de sistema exige aprobación explícita."
        : "La configuración del usuario exige aprobación explícita.";
  } else if (autoCount >= actionLimit) {
    decision = "block";
    reason = "Se alcanzó el límite diario de acciones automáticas.";
  } else if (usedRisk + riskPoints > profile.max_daily_risk_points) {
    decision = "block";
    reason = "La acción superaría el presupuesto diario de riesgo automático.";
  } else {
    decision = "allow";
    reason = "La acción está dentro del nivel, riesgo y límites permitidos.";
  }

  const admin: any = createAdminClient();
  let approval = null;

  if (decision === "approval") {
    const expiresAt = new Date(
      Date.now() + Number(profile.approval_ttl_minutes) * 60_000,
    ).toISOString();

    const { data, error } = await admin
      .from("eos_action_approvals_v12")
      .insert({
        usuario_id: user.id,
        request_id: requestId,
        accion: action,
        risk_tier: riskTier,
        risk_points: riskPoints,
        requested_level: configuredLevel,
        effective_level: effectiveLevel,
        status: "pending",
        reason,
        payload_snapshot: payload,
        payload_fingerprint: stableFingerprint(payload),
        expires_at: expiresAt,
      })
      .select("id,request_id,accion,status,risk_tier,risk_points,expires_at,created_at")
      .single();

    if (error) {
      console.error("No se pudo crear aprobación EOS:", error);
      return NextResponse.json(
        { error: "No pudimos crear la solicitud de aprobación." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    approval = data;
  }

  const eventType =
    decision === "allow"
      ? "auto_allowed"
      : decision === "approval"
        ? "approval_requested"
        : decision === "block"
          ? "auto_blocked"
          : "evaluated";

  const { error: eventError } = await admin.from("eos_autonomy_events_v12").insert({
    usuario_id: user.id,
    approval_id: approval?.id || null,
    event_type: eventType,
    actor: "eos",
    detail: {
      request_id: requestId,
      accion: action,
      decision,
      reason,
      configured_level: configuredLevel,
      effective_level: effectiveLevel,
      risk_tier: riskTier,
      risk_points: riskPoints,
      daily_auto_count: autoCount,
      daily_auto_limit: actionLimit,
      daily_risk_used: usedRisk,
      daily_risk_limit: profile.max_daily_risk_points,
    },
  });

  if (eventError) {
    console.error("No se pudo registrar evaluación de autonomía:", eventError);
  }

  return NextResponse.json(
    responseBody({
      requestId,
      action,
      decision,
      reason,
      configuredLevel,
      effectiveLevel,
      systemRisk,
      riskTier,
      riskPoints,
      autoCount,
      actionLimit,
      usedRisk,
      riskLimit: profile.max_daily_risk_points,
      approval,
    }),
    { headers: noStoreHeaders() },
  );
}
