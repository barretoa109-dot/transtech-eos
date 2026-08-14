import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

export async function GET() {
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

    const [twinResult, historyResult] = await Promise.all([
      supabase
        .from("eos_business_twin_current_v14")
        .select("*")
        .eq("usuario_id", user.id)
        .maybeSingle(),
      supabase
        .from("eos_business_twin_snapshots_v14")
        .select("id,version,confidence,source_completeness,generated_at,created_at,snapshot")
        .eq("usuario_id", user.id)
        .order("version", { ascending: false })
        .limit(12),
    ]);

    if (twinResult.error || historyResult.error) {
      console.error("No se pudo cargar Business Twin:", {
        twin: twinResult.error,
        history: historyResult.error,
      });

      return NextResponse.json(
        { error: "No pudimos cargar tu Business Twin." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    return NextResponse.json(
      {
        twin: twinResult.data || null,
        history: historyResult.data || [],
        needs_refresh: !twinResult.data || Boolean(twinResult.data.is_stale),
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error("Error leyendo Business Twin:", error);

    return NextResponse.json(
      { error: "No se pudo leer el Business Twin." },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
