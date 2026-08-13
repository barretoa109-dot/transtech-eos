import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHUNK_SIZE = 4_000;
const CHUNK_OVERLAP = 350;
const MAX_FINDINGS = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type FindingType =
  | "fact"
  | "metric"
  | "date"
  | "money"
  | "obligation"
  | "risk"
  | "opportunity"
  | "decision"
  | "action"
  | "person"
  | "organization"
  | "reference";

type Finding = {
  finding_type: FindingType;
  title: string;
  value_text: string | null;
  normalized_value: Record<string, unknown>;
  evidence_text: string;
  confidence: number;
  importance: number;
  metadata: Record<string, unknown>;
};

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function excerpt(value: string, max = 360) {
  const clean = normalizeWhitespace(value);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function splitSentences(text: string) {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?;:\n])\s+/)
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length >= 12);
}

function chunkText(text: string) {
  const chunks: Array<{
    chunk_index: number;
    content: string;
    char_start: number;
    char_end: number;
  }> = [];

  let start = 0;
  let index = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + CHUNK_SIZE, text.length);
    let end = hardEnd;

    if (hardEnd < text.length) {
      const candidate = text.lastIndexOf("\n", hardEnd);
      if (candidate > start + Math.floor(CHUNK_SIZE * 0.6)) {
        end = candidate;
      }
    }

    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        chunk_index: index,
        content,
        char_start: start,
        char_end: end,
      });
      index += 1;
    }

    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function addFinding(
  findings: Finding[],
  seen: Set<string>,
  finding: Finding,
) {
  if (findings.length >= MAX_FINDINGS) return;

  const key = `${finding.finding_type}:${normalizeWhitespace(
    finding.value_text || finding.evidence_text,
  ).toLowerCase()}`;

  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

function detectMoney(sentence: string, findings: Finding[], seen: Set<string>) {
  const patterns = [
    /(?:USD|US\$|Gs\.?|PYG|₲|\$)\s?\d[\d.,]*/gi,
    /\d[\d.,]*\s?(?:USD|dólares?|guaraníes?|Gs\.?|PYG)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of sentence.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (!value) continue;

      addFinding(findings, seen, {
        finding_type: "money",
        title: "Importe detectado",
        value_text: value,
        normalized_value: { raw: value },
        evidence_text: excerpt(sentence),
        confidence: 0.94,
        importance: 3,
        metadata: { detector: "money-regex-v1" },
      });
    }
  }
}

function detectDates(sentence: string, findings: Finding[], seen: Set<string>) {
  const patterns = [
    /\b(?:0?[1-9]|[12]\d|3[01])[\/.-](?:0?[1-9]|1[0-2])[\/.-](?:19|20)?\d{2}\b/g,
    /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+(?:19|20)\d{2}\b/gi,
    /\b(?:0?[1-9]|[12]\d|3[01])\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(?:19|20)\d{2})?\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of sentence.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (!value) continue;

      addFinding(findings, seen, {
        finding_type: "date",
        title: "Fecha detectada",
        value_text: value,
        normalized_value: { raw: value },
        evidence_text: excerpt(sentence),
        confidence: 0.9,
        importance: 2,
        metadata: { detector: "date-regex-v1" },
      });
    }
  }
}

function detectSemanticSignals(
  sentence: string,
  findings: Finding[],
  seen: Set<string>,
) {
  const lower = sentence.toLocaleLowerCase("es");

  const detectors: Array<{
    type: FindingType;
    title: string;
    terms: string[];
    importance: number;
    confidence: number;
  }> = [
    {
      type: "obligation",
      title: "Obligación o compromiso",
      terms: [
        "deberá",
        "debe ",
        "deber de",
        "obligación",
        "obligatorio",
        "se compromete",
        "tendrá que",
        "vence",
        "vencimiento",
      ],
      importance: 5,
      confidence: 0.82,
    },
    {
      type: "risk",
      title: "Riesgo o condición adversa",
      terms: [
        "riesgo",
        "penalidad",
        "multa",
        "incumplimiento",
        "pérdida",
        "retraso",
        "cancelación",
        "rescindir",
        "resolución del contrato",
      ],
      importance: 5,
      confidence: 0.8,
    },
    {
      type: "opportunity",
      title: "Oportunidad detectada",
      terms: [
        "oportunidad",
        "ahorro",
        "descuento",
        "crecimiento",
        "incrementar",
        "mejorar margen",
        "optimizar",
      ],
      importance: 4,
      confidence: 0.76,
    },
    {
      type: "decision",
      title: "Decisión registrada",
      terms: [
        "se decide",
        "decidimos",
        "se aprobó",
        "se aprueba",
        "resolvemos",
        "se resolvió",
        "queda aprobado",
      ],
      importance: 4,
      confidence: 0.84,
    },
    {
      type: "action",
      title: "Acción pendiente o indicada",
      terms: [
        "realizar ",
        "enviar ",
        "presentar ",
        "pagar ",
        "contactar ",
        "revisar ",
        "completar ",
        "implementar ",
        "entregar ",
      ],
      importance: 4,
      confidence: 0.72,
    },
  ];

  for (const detector of detectors) {
    const matched = detector.terms.find((term) => lower.includes(term));
    if (!matched) continue;

    addFinding(findings, seen, {
      finding_type: detector.type,
      title: detector.title,
      value_text: excerpt(sentence, 220),
      normalized_value: { matched_term: matched.trim() },
      evidence_text: excerpt(sentence),
      confidence: detector.confidence,
      importance: detector.importance,
      metadata: { detector: "semantic-keywords-v1" },
    });
  }
}

function detectMetrics(sentence: string, findings: Finding[], seen: Set<string>) {
  const metricPattern = /\b\d+(?:[.,]\d+)?\s?%\b/g;

  for (const match of sentence.matchAll(metricPattern)) {
    const value = match[0]?.trim();
    if (!value) continue;

    addFinding(findings, seen, {
      finding_type: "metric",
      title: "Métrica porcentual",
      value_text: value,
      normalized_value: {
        raw: value,
        percent: Number(value.replace("%", "").replace(",", ".")),
      },
      evidence_text: excerpt(sentence),
      confidence: 0.96,
      importance: 3,
      metadata: { detector: "percentage-regex-v1" },
    });
  }
}

function deriveFindings(text: string) {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const sentences = splitSentences(text).slice(0, 1_500);

  for (const sentence of sentences) {
    detectMoney(sentence, findings, seen);
    detectDates(sentence, findings, seen);
    detectMetrics(sentence, findings, seen);
    detectSemanticSignals(sentence, findings, seen);

    if (findings.length >= MAX_FINDINGS) break;
  }

  return findings.sort(
    (a, b) => b.importance - a.importance || b.confidence - a.confidence,
  );
}

function buildSummary(text: string, findings: Finding[]) {
  const compact = normalizeWhitespace(text);
  const preview = compact.slice(0, 650);
  const important = findings.filter((finding) => finding.importance >= 4).slice(0, 4);

  const parts = [
    preview ? `${preview}${compact.length > preview.length ? "…" : ""}` : "",
    important.length
      ? `Se detectaron ${important.length} señales prioritarias: ${important
          .map((finding) => finding.title.toLowerCase())
          .join(", ")}.`
      : "",
  ];

  return parts.filter(Boolean).join(" ").slice(0, 1_400);
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "Documento inválido." },
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
        { error: "Debés iniciar sesión para analizar documentos." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const { data: document, error: documentError } = await supabase
      .from("eos_documents_v11")
      .select(
        "id,nombre,extracted_text,extraction_status,intelligence_status,document_type,metadata",
      )
      .eq("id", id)
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (documentError) {
      console.error("No se pudo cargar documento para análisis:", documentError);
      return NextResponse.json(
        { error: "No pudimos cargar el documento." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    if (!document) {
      return NextResponse.json(
        { error: "Documento no encontrado." },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    const text = String(document.extracted_text || "").trim();

    if (!text) {
      return NextResponse.json(
        {
          error:
            document.extraction_status === "unsupported"
              ? "Este formato está almacenado, pero su extracción todavía está pendiente."
              : "El documento no contiene texto extraíble todavía.",
          extraction_status: document.extraction_status,
        },
        { status: 409, headers: noStoreHeaders() },
      );
    }

    const requestId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { data: run, error: runError } = await supabase
      .from("eos_document_intelligence_runs_v11")
      .insert({
        document_id: document.id,
        usuario_id: user.id,
        request_id: requestId,
        status: "processing",
        model_version: "deterministic-v1",
        prompt_version: "document-intelligence-signals-v1",
        started_at: now,
      })
      .select("id")
      .single();

    if (runError || !run) {
      console.error("No se pudo iniciar análisis documental:", runError);
      return NextResponse.json(
        { error: "No pudimos iniciar el análisis documental." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    try {
      const chunks = chunkText(text);
      const findings = deriveFindings(text);
      const summary = buildSummary(text, findings);

      const result = {
        chunk_count: chunks.length,
        finding_count: findings.length,
        high_importance_count: findings.filter(
          (finding) => finding.importance >= 4,
        ).length,
        finding_types: Array.from(
          new Set(findings.map((finding) => finding.finding_type)),
        ),
      };
      const analyzedAt = new Date().toISOString();

      const { error: commitError } = await supabase.rpc(
        "eos_commit_document_analysis_v29",
        {
          p_document_id: document.id,
          p_run_id: run.id,
          p_summary: summary,
          p_chunks: chunks.map((chunk) => ({
            ...chunk,
            metadata: { chunker: "chars-overlap-v1" },
          })),
          p_findings: findings,
          p_result: result,
          p_analysis_metadata: {
            version: "deterministic-v1",
            chunk_count: chunks.length,
            finding_count: findings.length,
            analyzed_at: analyzedAt,
          },
        },
      );

      if (commitError) throw commitError;

      return NextResponse.json(
        {
          ok: true,
          document_id: document.id,
          summary,
          ...result,
          top_findings: findings.slice(0, 10),
        },
        { headers: noStoreHeaders() },
      );
    } catch (analysisError) {
      console.error("Falló análisis documental:", analysisError);

      await supabase
        .from("eos_document_intelligence_runs_v11")
        .update({
          status: "error",
          error_message:
            analysisError instanceof Error
              ? analysisError.message
              : "Error de análisis documental.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("usuario_id", user.id);

      const analysisErrorMessage =
        analysisError instanceof Error
          ? analysisError.message
          : analysisError && typeof analysisError === "object" && "message" in analysisError
            ? String((analysisError as { message?: unknown }).message || "")
            : "";
      const staleAnalysisRun = analysisErrorMessage.includes("EOS_STALE_ANALYSIS_RUN");

      if (!staleAnalysisRun && document.intelligence_status !== "ready") {
        await supabase
          .from("eos_documents_v11")
          .update({ intelligence_status: "error" })
          .eq("id", document.id)
          .eq("usuario_id", user.id);
      }

      return NextResponse.json(
        { error: "No pudimos completar el análisis documental." },
        { status: 500, headers: noStoreHeaders() },
      );
    }
  } catch (error) {
    console.error("Error en Document Intelligence analyze:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo analizar el documento.",
      },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
