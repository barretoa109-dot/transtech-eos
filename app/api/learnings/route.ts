import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [summaryResult, learningsResult, snapshotsResult] = await Promise.all([
    supabase
      .from("eos_learning_summary_v7")
      .select("evidence_count,positive_count,negative_count,neutral_count,evidence_type_count,eligible,active_learnings,average_confidence,latest_learning_at")
      .eq("usuario_id", user.id)
      .maybeSingle(),
    supabase
      .from("eos_learning_longitudinal_v13")
      .select("id,clave,categoria,patron,recomendacion,tendencia,confianza,evidence_count,positive_count,negative_count,estado,first_observed_at,last_observed_at,generated_at,updated_at,snapshot_count,first_snapshot_day,latest_snapshot_day,first_confidence,latest_confidence,confidence_delta,evidence_delta,days_since_observed,contradictory,longitudinal_state")
      .eq("usuario_id", user.id)
      .order("confianza", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("eos_learning_snapshots_v13")
      .select("learning_id,snapshot_day,confianza,evidence_count,positive_count,negative_count,tendencia,estado,captured_at")
      .eq("usuario_id", user.id)
      .gte("snapshot_day", since)
      .order("snapshot_day", { ascending: true })
      .limit(500),
  ]);

  if (summaryResult.error || learningsResult.error || snapshotsResult.error) {
    console.error("No se pudieron cargar los aprendizajes longitudinales:", {
      summary: summaryResult.error,
      learnings: learningsResult.error,
      snapshots: snapshotsResult.error,
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

  const snapshotsByLearning = (snapshotsResult.data ?? []).reduce<
    Record<string, unknown[]>
  >((acc, snapshot) => {
    const id = String(snapshot.learning_id);
    if (!acc[id]) acc[id] = [];
    acc[id].push(snapshot);
    return acc;
  }, {});

  const learnings = (learningsResult.data ?? []).map((learning) => ({
    ...learning,
    history: snapshotsByLearning[String(learning.id)] ?? [],
  }));

  const longitudinalSummary = learnings.reduce(
    (acc, learning) => {
      const state = String(learning.longitudinal_state || "new");
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return NextResponse.json(
    {
      summary,
      longitudinal_summary: longitudinalSummary,
      learnings,
      minimum_evidence: 3,
      history_window_days: 180,
    },
    { headers: noStoreHeaders() },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
