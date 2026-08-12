import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  const [goals, followups, actions, decisions, learnings, context] = await Promise.all([
    supabase.from("eos_goals").select("progreso,estado").eq("usuario_id", user.id),
    supabase.from("eos_proactive_followups").select("severidad,estado").eq("usuario_id", user.id).in("estado", ["pendiente", "visto"]),
    supabase.from("eos_action_commands").select("estado").eq("usuario_id", user.id).limit(100),
    supabase.from("eos_decision_registry_v6").select("estado,result_count").eq("usuario_id", user.id).limit(100),
    supabase.from("eos_learnings").select("confianza,evidence_count,estado").eq("usuario_id", user.id).eq("estado", "activo").limit(100),
    supabase.from("eos_master_context_v8").select("identidad,estado_actual,objetivos,proyectos,compromisos,necesita_actualizacion").eq("usuario_id", user.id).maybeSingle(),
  ]);

  const queryError = [goals.error, followups.error, actions.error, decisions.error, learnings.error, context.error].find(Boolean);
  if (queryError) {
    console.error("No se pudo calcular EOS Intelligence Score:", queryError);
    return NextResponse.json({ error: "No pudimos calcular tu EOS Score." }, { status: 500 });
  }

  const activeGoals = (goals.data ?? []).filter((item) => item.estado === "activo");
  const completedActions = (actions.data ?? []).filter((item) => item.estado === "completada").length;
  const failedActions = (actions.data ?? []).filter((item) => item.estado === "error").length;
  const measuredDecisions = (decisions.data ?? []).filter((item) => Number(item.result_count) > 0).length;
  const totalDecisions = decisions.data?.length ?? 0;
  const evidenceCount = (learnings.data ?? []).reduce((sum, item) => sum + Number(item.evidence_count ?? 0), 0);
  const criticalAlerts = (followups.data ?? []).filter((item) => item.severidad === "critica").length;

  const dimensions = {
    contexto: clamp((context.data ? 78 : 20) + (context.data?.necesita_actualizacion ? -18 : 12)),
    objetivos: clamp(activeGoals.length
      ? average(activeGoals.map((item) => Number(item.progreso ?? 0)))
      : 25),
    ejecucion: clamp(actions.data?.length
      ? 45 + completedActions * 8 - failedActions * 12
      : 30),
    decisiones: clamp(totalDecisions
      ? 35 + (measuredDecisions / totalDecisions) * 65
      : 25),
    aprendizaje: clamp(20 + evidenceCount * 5 + (learnings.data?.length ?? 0) * 6),
  };

  const score = clamp(
    dimensions.contexto * 0.2
      + dimensions.objetivos * 0.25
      + dimensions.ejecucion * 0.25
      + dimensions.decisiones * 0.15
      + dimensions.aprendizaje * 0.15
      - criticalAlerts * 3,
  );

  const weakest = Object.entries(dimensions).sort(([, left], [, right]) => left - right)[0];
  const strongest = Object.entries(dimensions).sort(([, left], [, right]) => right - left)[0];

  return NextResponse.json({
    score,
    dimensions,
    explanation: {
      strongest: { dimension: strongest[0], score: strongest[1] },
      weakest: { dimension: weakest[0], score: weakest[1] },
      summary: `Tu dimensión más sólida es ${label(strongest[0])}. La mayor oportunidad está en ${label(weakest[0])}.`,
      next_action: nextAction(weakest[0]),
    },
    signals: {
      active_goals: activeGoals.length,
      pending_alerts: followups.data?.length ?? 0,
      completed_actions: completedActions,
      measured_decisions: measuredDecisions,
      learning_evidence: evidenceCount,
    },
    calculated_at: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function label(value: string) {
  return ({ contexto: "Contexto", objetivos: "Objetivos", ejecucion: "Ejecución", decisiones: "Decisiones", aprendizaje: "Aprendizaje" } as Record<string, string>)[value] ?? value;
}

function nextAction(dimension: string) {
  return ({
    contexto: "Completá el estado actual y la prioridad principal de tu empresa.",
    objetivos: "Actualizá la evidencia y el próximo paso del objetivo prioritario.",
    ejecucion: "Cerrá o reintentá la acción pendiente de mayor impacto.",
    decisiones: "Registrá el resultado real de una decisión que ya debía medirse.",
    aprendizaje: "Reuní al menos tres resultados comparables para validar un patrón.",
  } as Record<string, string>)[dimension] ?? "Revisá la próxima mejor acción de tu Contexto Maestro.";
}
