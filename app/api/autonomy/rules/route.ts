import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ACTIONS = new Set([
  "RESPONDER",
  "GENERAR_EXCEL",
  "GENERAR_PDF",
  "GENERAR_WORD",
  "CREAR_TAREA",
  "CREAR_OBJETIVO",
  "GUARDAR_MEMORIA",
  "VER_DASHBOARD",
  "VER_BRIEFING",
]);

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
    !ACTIONS.has(action) ||
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

  if (!ACTIONS.has(action)) {
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
