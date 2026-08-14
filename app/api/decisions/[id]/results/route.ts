import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const VALID_TYPES = new Set(["positivo", "neutral", "negativo", "inconcluso", "observacion"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const resumen = typeof body?.resumen === "string" ? body.resumen.trim().slice(0, 3000) : "";
  const aprendizaje = typeof body?.aprendizaje === "string" ? body.aprendizaje.trim().slice(0, 3000) : "";
  const tipo = VALID_TYPES.has(body?.tipo) ? body.tipo : "observacion";

  if (!resumen) {
    return NextResponse.json({ error: "El resultado es obligatorio." }, { status: 400 });
  }

  const { data: decision } = await supabase
    .from("eos_decisions")
    .select("id")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (!decision) {
    return NextResponse.json({ error: "Decisión no encontrada." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("eos_decision_results")
    .insert({
      decision_id: id,
      usuario_id: user.id,
      tipo,
      resumen,
      aprendizaje: aprendizaje || null,
      fuente: "eos-web",
    })
    .select("*")
    .single();

  if (error) {
    console.error("No se pudo registrar el resultado:", error);
    return NextResponse.json({ error: "No pudimos registrar el resultado." }, { status: 500 });
  }

  const evaluation = evaluateResult(tipo, resumen, aprendizaje);
  const { error: evaluationError } = await supabase
    .from("eos_decisions")
    .update({
      resultado_estado: evaluation.status,
      evaluacion_eos: evaluation.summary,
      evaluacion_confianza: evaluation.confidence,
      evaluada_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("usuario_id", user.id);

  if (evaluationError) {
    console.error("El resultado se guardó, pero no se pudo evaluar la decisión:", evaluationError);
  }

  return NextResponse.json(
    {
      result: data,
      evaluation: evaluationError ? null : evaluation,
    },
    { status: 201 },
  );
}

function evaluateResult(tipo: string, resumen: string, aprendizaje: string) {
  const labels: Record<string, { status: string; confidence: number; verdict: string }> = {
    positivo: { status: "validado", confidence: 0.8, verdict: "produjo un resultado positivo" },
    neutral: { status: "validado", confidence: 0.65, verdict: "produjo un resultado neutral" },
    negativo: { status: "validado", confidence: 0.8, verdict: "produjo un resultado negativo" },
    inconcluso: { status: "inconcluso", confidence: 0.45, verdict: "todavía no permite una conclusión firme" },
    observacion: { status: "midiendo", confidence: 0.35, verdict: "sigue en etapa de medición" },
  };
  const selected = labels[tipo] ?? labels.observacion;
  const evidence = aprendizaje || resumen;

  return {
    status: selected.status,
    confidence: selected.confidence,
    summary: `La decisión ${selected.verdict}. Evidencia registrada: ${evidence}`.slice(0, 3000),
  };
}
