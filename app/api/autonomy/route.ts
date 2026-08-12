import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

function validInteger(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

export async function GET() {
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

  const [profileResult, rulesResult, approvalsResult, eventsResult] =
    await Promise.all([
      supabase
        .from("eos_autonomy_profiles_v12")
        .select("*")
        .eq("usuario_id", user.id)
        .maybeSingle(),
      supabase
        .from("eos_autonomy_rules_v12")
        .select("*")
        .eq("usuario_id", user.id)
        .order("accion", { ascending: true }),
      supabase
        .from("eos_action_approvals_v12")
        .select("id,command_id,request_id,accion,risk_tier,risk_points,requested_level,effective_level,status,reason,expires_at,decided_at,created_at")
        .eq("usuario_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("eos_autonomy_events_v12")
        .select("id,approval_id,command_id,event_type,actor,detail,created_at")
        .eq("usuario_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const firstError =
    profileResult.error ||
    rulesResult.error ||
    approvalsResult.error ||
    eventsResult.error;

  if (firstError) {
    console.error("No se pudo cargar autonomía EOS:", firstError);
    return NextResponse.json(
      { error: "No pudimos cargar la configuración de autonomía." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    {
      profile: profileResult.data || {
        usuario_id: user.id,
        ...DEFAULT_PROFILE,
      },
      profile_persisted: Boolean(profileResult.data),
      rules: rulesResult.data || [],
      pending_approvals: approvalsResult.data || [],
      recent_events: eventsResult.data || [],
    },
    { headers: noStoreHeaders() },
  );
}

export async function PATCH(request: Request) {
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
  const defaultLevel = validInteger(body?.default_level, 0, 3);
  const maxAuto = validInteger(body?.max_auto_actions_per_day, 0, 100);
  const maxRisk = validInteger(body?.max_daily_risk_points, 0, 1000);
  const ttl = validInteger(body?.approval_ttl_minutes, 5, 10080);
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;

  if (
    defaultLevel === null ||
    maxAuto === null ||
    maxRisk === null ||
    ttl === null ||
    enabled === null
  ) {
    return NextResponse.json(
      { error: "La configuración de autonomía contiene valores inválidos." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data, error } = await supabase
    .from("eos_autonomy_profiles_v12")
    .upsert(
      {
        usuario_id: user.id,
        default_level: defaultLevel,
        max_auto_actions_per_day: maxAuto,
        max_daily_risk_points: maxRisk,
        approval_ttl_minutes: ttl,
        enabled,
      },
      { onConflict: "usuario_id" },
    )
    .select("*")
    .single();

  if (error) {
    console.error("No se pudo actualizar autonomía EOS:", error);
    return NextResponse.json(
      { error: "No pudimos guardar la configuración de autonomía." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    { ok: true, profile: data },
    { headers: noStoreHeaders() },
  );
}
