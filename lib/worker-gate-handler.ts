import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLICY_VERSION = "eos-worker-gate-v1";

type SystemRisk = {
  tier: number;
  points: number;
  maxLevel: number;
};

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
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
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

function fingerprint(value: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function authorized(request: Request) {
  const expected = process.env.EOS_WORKER_GATE_SECRET;
  if (!expected) return { ok: false, unavailable: true };

  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!supplied) return { ok: false, unavailable: false };

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (expectedBuffer.length !== suppliedBuffer.length) {
    return { ok: false, unavailable: false };
  }

  return {
    ok: timingSafeEqual(expectedBuffer, suppliedBuffer),
    unavailable: false,
  };
}

async function logEvent(
  admin: any,
  params: {
    usuarioId: string;
    approvalId?: string | null;
    commandId?: string | null;
    eventType:
      | "evaluated"
      | "approval_requested"
      | "auto_allowed"
      | "auto_blocked";
    detail: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("eos_autonomy_events_v12").insert({
    usuario_id: params.usuarioId,
    approval_id: params.approvalId || null,
    command_id: params.commandId || null,
    event_type: params.eventType,
    actor: "service",
    detail: {
      ...params.detail,
      policy_version: POLICY_VERSION,
    },
  });

  if (error) {
    console.error("Worker gate: no se pudo registrar evento:", error);
  }
}

export async function POST(request: Request) {
  try {
    const authorization = authorized(request);

    if (authorization.unavailable) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Worker gate no configurado.",
        },
        { status: 503, headers: noStoreHeaders() },
      );
    }

    if (!authorization.ok) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "No autorizado.",
        },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const body = await request.json().catch(() => null);
    const usuarioId = body?.usuario_id;
    const requestId = body?.request_id;
    const action = typeof body?.accion === "string" ? body.accion.trim() : "";
    const commandId = body?.command_id ?? null;
    const approvalId = body?.approval_id ?? null;
    const consumeApproval = body?.consume_approval === true;
    const payload = safeObject(body?.payload);
    const systemRisk = SYSTEM_RISK[action];

    if (!isUuid(usuarioId) || !isUuid(requestId) || !systemRisk) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Solicitud de gate inválida.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (commandId !== null && !isUuid(commandId)) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "command_id inválido.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (approvalId !== null && !isUuid(approvalId)) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "approval_id inválido.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (consumeApproval && (!approvalId || !commandId)) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error:
            "Para consumir una aprobación se requieren approval_id y command_id.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const admin: any = createAdminClient();

    const { data: userExists, error: userError } = await admin
      .from("usuarios")
      .select("id")
      .eq("id", usuarioId)
      .maybeSingle();

    if (userError || !userExists) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Usuario no válido para ejecución.",
        },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    if (consumeApproval && approvalId && commandId) {
      const { data, error } = await admin.rpc(
        "eos_consume_action_approval_v12",
        {
          p_approval_id: approvalId,
          p_command_id: commandId,
        },
      );

      if (error) {
        console.error("Worker gate: consumo de aprobación rechazado:", error);

        return NextResponse.json(
          {
            ok: false,
            execute: false,
            decision: "block",
            reason: "La aprobación no pudo consumirse de forma segura.",
          },
          { status: 409, headers: noStoreHeaders() },
        );
      }

      return NextResponse.json(
        {
          ok: true,
          execute: true,
          decision: "allow",
          reason: "Aprobación explícita consumida de forma atómica.",
          consumed: true,
          approval: Array.isArray(data) ? data[0] || null : data,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    const [profileResult, ruleResult, approvalResult, priorEventResult, dailyEventsResult] =
      await Promise.all([
        admin
          .from("eos_autonomy_profiles_v12")
          .select(
            "default_level,max_auto_actions_per_day,max_daily_risk_points,approval_ttl_minutes,enabled",
          )
          .eq("usuario_id", usuarioId)
          .maybeSingle(),
        admin
          .from("eos_autonomy_rules_v12")
          .select(
            "autonomy_level,risk_tier,risk_points,max_auto_per_day,enabled,require_fresh_context",
          )
          .eq("usuario_id", usuarioId)
          .eq("accion", action)
          .maybeSingle(),
        admin
          .from("eos_action_approvals_v12")
          .select(
            "id,request_id,accion,status,risk_tier,risk_points,requested_level,effective_level,reason,expires_at,decided_at,created_at",
          )
          .eq("usuario_id", usuarioId)
          .eq("request_id", requestId)
          .eq("accion", action)
          .maybeSingle(),
        admin
          .from("eos_autonomy_events_v12")
          .select("id,event_type,detail,created_at")
          .eq("usuario_id", usuarioId)
          .contains("detail", { request_id: requestId, accion: action })
          .order("created_at", { ascending: false })
          .limit(1),
        admin
          .from("eos_autonomy_events_v12")
          .select("event_type,detail")
          .eq("usuario_id", usuarioId)
          .eq("event_type", "auto_allowed")
          .gte("created_at", startOfUtcDay()),
      ]);

    const readError =
      profileResult.error ||
      ruleResult.error ||
      approvalResult.error ||
      priorEventResult.error ||
      dailyEventsResult.error;

    if (readError) {
      console.error("Worker gate: error leyendo autonomía:", readError);
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          reason: "No fue posible verificar la política de autonomía.",
        },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    const profile = { ...DEFAULT_PROFILE, ...(profileResult.data || {}) };
    const rule = ruleResult.data;
    const configuredLevel =
      rule?.enabled === false
        ? 0
        : Number(rule?.autonomy_level ?? profile.default_level);
    const effectiveLevel = Math.min(configuredLevel, systemRisk.maxLevel);
    const riskTier = Math.max(systemRisk.tier, Number(rule?.risk_tier ?? 0));
    const riskPoints = Math.max(systemRisk.points, Number(rule?.risk_points ?? 0));
    const autoEvents = dailyEventsResult.data || [];
    const autoCount = autoEvents.length;
    const usedRisk = autoEvents.reduce((total: number, event: any) => {
      const detail = safeObject(event.detail);
      const points = Number(detail.risk_points || 0);
      return total + (Number.isFinite(points) ? points : 0);
    }, 0);
    const actionLimit =
      rule?.max_auto_per_day === null || rule?.max_auto_per_day === undefined
        ? Number(profile.max_auto_actions_per_day)
        : Math.min(
            Number(profile.max_auto_actions_per_day),
            Number(rule.max_auto_per_day),
          );

    const existingApproval = approvalResult.data;

    if (existingApproval) {
      const expired = new Date(existingApproval.expires_at).getTime() <= Date.now();

      if (existingApproval.status === "approved" && !expired) {
        return NextResponse.json(
          {
            ok: true,
            execute: false,
            decision: "approval_ready",
            reason:
              "La aprobación está lista. El Worker debe volver a llamar con consume_approval=true, approval_id y command_id justo antes del efecto secundario.",
            approval: existingApproval,
            policy_version: POLICY_VERSION,
          },
          { headers: noStoreHeaders() },
        );
      }

      if (existingApproval.status === "pending" && !expired) {
        return NextResponse.json(
          {
            ok: true,
            execute: false,
            decision: "approval",
            reason: existingApproval.reason || "Requiere aprobación explícita.",
            approval: existingApproval,
            policy_version: POLICY_VERSION,
          },
          { headers: noStoreHeaders() },
        );
      }

      return NextResponse.json(
        {
          ok: true,
          execute: false,
          decision: "block",
          reason: expired
            ? "La aprobación asociada ya venció."
            : `La aprobación está en estado ${existingApproval.status}.`,
          approval: existingApproval,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    const priorEvent = priorEventResult.data?.[0];
    const priorDetail = safeObject(priorEvent?.detail);

    if (
      priorEvent?.event_type === "auto_allowed" &&
      priorDetail.request_id === requestId &&
      priorDetail.accion === action
    ) {
      return NextResponse.json(
        {
          ok: true,
          execute: true,
          decision: "allow",
          reason: "Evaluación automática idempotente ya registrada.",
          idempotent: true,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    let decision: "recommend" | "prepare" | "approval" | "allow" | "block";
    let reason = "";

    if (!profile.enabled) {
      decision = "recommend";
      reason = "La autonomía está desactivada para este usuario.";
    } else if (effectiveLevel <= 0) {
      decision = "recommend";
      reason = "La política permite únicamente recomendar esta acción.";
    } else if (effectiveLevel === 1) {
      decision = "prepare";
      reason = "EOS puede preparar la acción, pero no ejecutar el efecto secundario.";
    } else if (effectiveLevel === 2 || riskTier >= 2) {
      decision = "approval";
      reason =
        riskTier >= 2
          ? "El riesgo mínimo de sistema exige aprobación explícita."
          : "La configuración del usuario exige aprobación explícita.";
    } else if (autoCount >= actionLimit) {
      decision = "block";
      reason = "Se alcanzó el límite diario de acciones automáticas.";
    } else if (usedRisk + riskPoints > Number(profile.max_daily_risk_points)) {
      decision = "block";
      reason = "La acción superaría el presupuesto diario de riesgo automático.";
    } else {
      decision = "allow";
      reason = "La acción está dentro del nivel, riesgo y límites permitidos.";
    }

    if (decision === "approval") {
      const expiresAt = new Date(
        Date.now() + Number(profile.approval_ttl_minutes) * 60_000,
      ).toISOString();

      const { data: approval, error: approvalError } = await admin
        .from("eos_action_approvals_v12")
        .insert({
          usuario_id: usuarioId,
          request_id: requestId,
          accion: action,
          risk_tier: riskTier,
          risk_points: riskPoints,
          requested_level: configuredLevel,
          effective_level: effectiveLevel,
          status: "pending",
          reason,
          payload_snapshot: payload,
          payload_fingerprint: fingerprint(payload),
          expires_at: expiresAt,
        })
        .select(
          "id,request_id,accion,status,risk_tier,risk_points,expires_at,created_at",
        )
        .single();

      if (approvalError) {
        console.error("Worker gate: no se pudo crear aprobación:", approvalError);
        return NextResponse.json(
          {
            ok: false,
            execute: false,
            decision: "block",
            reason: "No se pudo crear la solicitud de aprobación de forma segura.",
          },
          { status: 500, headers: noStoreHeaders() },
        );
      }

      await logEvent(admin, {
        usuarioId,
        approvalId: approval.id,
        commandId,
        eventType: "approval_requested",
        detail: {
          request_id: requestId,
          accion: action,
          decision,
          reason,
          configured_level: configuredLevel,
          effective_level: effectiveLevel,
          risk_tier: riskTier,
          risk_points: riskPoints,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          execute: false,
          decision: "approval",
          reason,
          approval,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    const eventType =
      decision === "allow"
        ? "auto_allowed"
        : decision === "block"
          ? "auto_blocked"
          : "evaluated";

    await logEvent(admin, {
      usuarioId,
      commandId,
      eventType,
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
        daily_risk_limit: Number(profile.max_daily_risk_points),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        execute: decision === "allow",
        decision,
        reason,
        effective_level: effectiveLevel,
        effective_risk: { tier: riskTier, points: riskPoints },
        daily_limits: {
          auto_count: autoCount,
          auto_limit: actionLimit,
          risk_used: usedRisk,
          risk_limit: Number(profile.max_daily_risk_points),
        },
        policy_version: POLICY_VERSION,
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error("Error en Worker gate:", error);

    return NextResponse.json(
      {
        ok: false,
        execute: false,
        decision: "block",
        error: "El gate interno falló y bloqueó la ejecución por seguridad.",
      },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
