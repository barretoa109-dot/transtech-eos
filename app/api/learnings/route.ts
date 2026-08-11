import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const [summaryResult, learningsResult] = await Promise.all([
    supabase
      .from("eos_learning_summary_v7")
      .select("evidence_count,positive_count,negative_count,neutral_count,evidence_type_count,eligible,active_learnings,average_confidence,latest_learning_at")
      .eq("usuario_id", user.id)
      .maybeSingle(),
    supabase
      .from("eos_learnings")
      .select("id,clave,categoria,patron,recomendacion,tendencia,confianza,evidence_count,positive_count,negative_count,first_observed_at,last_observed_at,generated_at,updated_at")
      .eq("usuario_id", user.id)
      .eq("estado", "activo")
      .order("confianza", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  if (summaryResult.error || learningsResult.error) {
    console.error("No se pudieron cargar los aprendizajes:", {
      summary: summaryResult.error,
      learnings: learningsResult.error,
    });

    return NextResponse.json(
      { error: "No pudimos cargar los aprendizajes en este momento." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  const summary = summaryResult.data ?? {
    evidence_count: 0,
    positive_count: 0,
    negative_count: 0,
    neutral_count: 0,
    evidence_type_count: 0,
    eligible: false,
    active_learnings: 0,
    average_confidence: null,
    latest_learning_at: null,
  };

  return NextResponse.json(
    { summary, learnings: learningsResult.data ?? [], minimum_evidence: 3 },
    { headers: noStoreHeaders() },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
