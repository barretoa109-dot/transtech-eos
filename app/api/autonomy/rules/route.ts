import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SystemPolicy = {
  minRiskTier: number;
  minRiskPoints: number;
  maxLevel: number;
};

const SYSTEM_POLICY: Record<string, SystemPolicy> = {
  RESPONDER: { minRiskTier: 0, minRiskPoints: 0, maxLevel: 3 },
  VER_DASHBOARD: { minRiskTier: 0, minRiskPoints: 0, maxLevel: 3 },
  VER_BRIEFING: { minRiskTier: 0, minRiskPoints: 0, maxLevel: 3 },
  GUARDAR_MEMORIA: { minRiskTier: 1, minRiskPoints: 1, maxLevel: 3 },
  GENERAR_EXCEL: { minRiskTier: 1, minRiskPoints: 1, maxLevel: 3 },
  GENERAR_PDF: { minRiskTier: 1, minRiskPoints: 1, maxLevel: 3 },
  GENERAR_WORD: { minRiskTier: 1, minRiskPoints: 1, maxLevel: 3 },
  CREAR_TAREA: { minRiskTier: 1, minRiskPoints: 2, maxLevel: 3 },
  CREAR_OBJETIVO: { minRiskTier: 2, minRiskPoints: 4, maxLevel: 2 },
};

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function integer(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

async function auth() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { supabase, user, error };
}

export async function PUT(request: Request) {
  const session = await auth();
  if (session.error || !session.user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const body = await request.json().catch(() => null);
  const action = typeof body?.accion === "string" ? body.accion.trim() : "";
  const systemPolicy = SYSTEM_POLICY[action];
  const autonomyLevel = integer(body?.autonomy_level, 0, 3);
  const riskTier = integer(body?.risk_tier, 0, 3);
  const riskPoints = integer(body?.risk_points, 0, 100);
  const maxAuto =
    body?.max_auto_per_day === null || body?.max_auto_per_day === undefined
      ? null
      : integer(body.max_auto_per_day, 0, 100);
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;
  const fresh =
    typeof body?.require_fresh_context === "boolean"
      ? body.require_fresh_context
      : null;

  if (
    !systemPolicy ||
    autonomyLevel === null ||
    riskTier === null ||
    riskPoints === null ||
    (body?.max_auto_per_day !== null &&
      body?.max_auto_per_day !== undefined &&
      maxAuto === null) ||
    enabled === null ||
    fresh === null
  ) {
    return NextResponse.json(
      { error: "La regla de autonomía contiene valores inválidos." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  if (autonomyLevel > systemPolicy.maxLevel) {
    return NextResponse.json(
      {
        error: "El nivel solicitado supera el máximo permitido por EOS para esta acción.",
        code: "EOS_AUTONOMY_LEVEL_EXCEEDS_SYSTEM_MAX",
      },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  if (
    riskTier < systemPolicy.minRiskTier ||
    riskPoints < systemPolicy.minRiskPoints
  ) {
    return NextResponse.json(
      {
        error: "El riesgo configurado no puede rebajar el mínimo de seguridad de EOS.",
        code: "EOS_AUTONOMY_RISK_BELOW_SYSTEM_MIN",
      },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data, error } = await session.supabase
    .from("eos_autonomy_rules_v12")
    .upsert(
      {
        usuario_id: session.user.id,
        accion: action,
        autonomy_level: autonomyLevel,
        risk_tier: riskTier,
        risk_points: riskPoints,
        max_auto_per_day: maxAuto,
        enabled,
        require_fresh_context: fresh,
      },
      { onConflict: "usuario_id,accion" },
    )
    .select("*")
    .single();

  if (error) {
    console.error("No se pudo guardar regla de autonomía:", error);
    return NextResponse.json(
      { error: "No pudimos guardar la regla de autonomía." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    { ok: true, rule: data },
    { headers: noStoreHeaders() },
  );
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (session.error || !session.user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const { searchParams } = new URL(request.url);
  const action = (searchParams.get("accion") || "").trim();

  if (!SYSTEM_POLICY[action]) {
    return NextResponse.json(
      { error: "Acción inválida." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { error } = await session.supabase
    .from("eos_autonomy_rules_v12")
    .delete()
    .eq("usuario_id", session.user.id)
    .eq("accion", action);

  if (error) {
    console.error("No se pudo eliminar regla de autonomía:", error);
    return NextResponse.json(
      { error: "No pudimos eliminar la regla de autonomía." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
}
