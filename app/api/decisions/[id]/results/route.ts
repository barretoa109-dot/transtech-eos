import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set([
  "positivo",
  "neutral",
  "negativo",
  "inconcluso",
  "observacion",
]);

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Decisión no válida." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const body = await request.json().catch(() => null);
  const resumen = typeof body?.resumen === "string" ? body.resumen.trim().slice(0, 3000) : "";
  const aprendizaje = typeof body?.aprendizaje === "string" ? body.aprendizaje.trim().slice(0, 3000) : "";
  const tipo = VALID_TYPES.has(body?.tipo) ? body.tipo : "observacion";
  const requestId = isUuid(String(body?.request_id || ""))
    ? String(body.request_id)
    : crypto.randomUUID();

  if (!resumen) {
    return NextResponse.json(
      { error: "El resultado es obligatorio." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data: decision, error: decisionError } = await supabase
    .from("eos_decisions")
    .select("id")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (decisionError) {
    console.error("No se pudo verificar la decisión:", decisionError);
    return NextResponse.json(
      { error: "No pudimos verificar la decisión." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  if (!decision) {
    return NextResponse.json(
      { error: "Decisión no encontrada." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  const evaluation = evaluateResult(tipo, resumen, aprendizaje);
  const { data: committed, error } = await supabase.rpc(
    "eos_record_decision_result_v32",
    {
      p_decision_id: id,
      p_request_id: requestId,
      p_tipo: tipo,
      p_resumen: resumen,
      p_aprendizaje: aprendizaje || null,
      p_evaluation_status: evaluation.status,
      p_evaluation_summary: evaluation.summary,
      p_evaluation_confidence: evaluation.confidence,
    },
  );

  if (error || !committed || typeof committed !== "object") {
    console.error("No se pudo registrar y evaluar el resultado:", error);
    return NextResponse.json(
      { error: "No pudimos registrar el resultado." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  const payload = committed as {
    result?: unknown;
    evaluation?: unknown;
    idempotent?: boolean;
  };

  return NextResponse.json(
    {
      result: payload.result ?? null,
      evaluation: payload.evaluation ?? evaluation,
      request_id: requestId,
      idempotent: Boolean(payload.idempotent),
    },
    { status: 201, headers: noStoreHeaders() },
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
