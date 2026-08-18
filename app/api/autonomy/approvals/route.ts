import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
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

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("eos_action_approvals_v12")
    .select(
      "id,request_id,accion,status,reason,risk_tier,risk_points,effective_level,payload_snapshot,expires_at,decided_at,created_at",
    )
    .eq("usuario_id", user.id)
    .in("status", ["pending", "approved"])
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("No se pudieron cargar aprobaciones EOS:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus aprobaciones pendientes." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    { approvals: data || [] },
    { headers: noStoreHeaders() },
  );
}
