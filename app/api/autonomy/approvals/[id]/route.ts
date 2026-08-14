import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Solicitud inválida." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

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
  const status = body?.status;

  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json(
      { error: "Solo podés aprobar o rechazar una solicitud." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data: current, error: currentError } = await supabase
    .from("eos_action_approvals_v12")
    .select("id,accion,status,expires_at,risk_tier,risk_points,effective_level")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (currentError) {
    console.error("No se pudo cargar aprobación EOS:", currentError);
    return NextResponse.json(
      { error: "No pudimos cargar la solicitud." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  if (!current) {
    return NextResponse.json(
      { error: "Solicitud no encontrada." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  if (current.status !== "pending") {
    return NextResponse.json(
      { error: "La solicitud ya fue resuelta.", approval: current },
      { status: 409, headers: noStoreHeaders() },
    );
  }

  if (new Date(current.expires_at).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "La solicitud ya venció." },
      { status: 409, headers: noStoreHeaders() },
    );
  }

  const { data, error } = await supabase
    .from("eos_action_approvals_v12")
    .update({ status })
    .eq("id", id)
    .eq("usuario_id", user.id)
    .eq("status", "pending")
    .select("id,request_id,accion,status,risk_tier,risk_points,effective_level,expires_at,decided_at")
    .single();

  if (error) {
    console.error("No se pudo resolver aprobación EOS:", error);
    return NextResponse.json(
      { error: "No pudimos registrar tu decisión." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    { ok: true, approval: data },
    { headers: noStoreHeaders() },
  );
}
