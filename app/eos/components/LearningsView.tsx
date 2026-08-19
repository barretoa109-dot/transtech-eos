"use client";

import { BrainCircuit, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Learning = {
  id: string;
  categoria: string;
  patron: string;
  recomendacion: string;
  tendencia: "positiva" | "neutral" | "negativa" | "mixta";
  confianza: number;
  evidence_count: number;
  positive_count: number;
  negative_count: number;
  last_observed_at: string | null;
};

type Summary = {
  evidence_count: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  evidence_type_count: number;
  eligible: boolean;
  active_learnings: number;
  average_confidence: number | null;
  latest_learning_at: string | null;
};

const emptySummary: Summary = {
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

function trendIcon(tendencia: Learning["tendencia"]) {
  if (tendencia === "positiva") return <TrendingUp size={17} />;
  if (tendencia === "negativa") return <TrendingDown size={17} />;
  return <BrainCircuit size={17} />;
}

export default function LearningsView() {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [minimumEvidence, setMinimumEvidence] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/learnings", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSummary(payload.summary ?? emptySummary);
      setLearnings(payload.learnings ?? []);
      setMinimumEvidence(payload.minimum_evidence ?? 3);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar los aprendizajes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const progress = Math.min(100, Math.round((summary.evidence_count / minimumEvidence) * 100));

  return (
    <div className="view" id="view-aprendizajes">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Aprendizajes</div>
          <div className="page-title">Patrones comprobados</div>
          <div className="page-sub">Lo que EOS fue detectando sobre tu negocio a partir de los datos reales.</div>
        </div>

        <div className="chip-row">
          <button
            type="button"
            className="chip"
            onClick={() => void load()}
            disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={12} className={loading ? "learn-spin" : ""} />
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="l">Patrones aprendidos</div>
            <div className="v">{summary.active_learnings}</div>
          </div>
          <div className="kpi-card">
            <div className="l">Evidencias válidas</div>
            <div className="v">{summary.evidence_count}</div>
          </div>
          <div className="kpi-card">
            <div className="l">Confianza media</div>
            <div className="v">{formatConfidence(summary.average_confidence)}</div>
          </div>
          <div className="kpi-card">
            <div className="l">Tipos de evidencia</div>
            <div className="v">{summary.evidence_type_count}</div>
          </div>
        </div>

        {error && (
          <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
            {error}
          </div>
        )}

        {!loading && !summary.eligible && (
          <div className="card">
            <div className="card-title">Recopilando evidencia</div>
            <p className="prose">
              EOS todavía no tiene resultados suficientes para aprender. Necesita al menos {minimumEvidence} resultados
              verificables — actualmente hay {summary.evidence_count}. Las decisiones sin resultado no se usan para
              inferir patrones.
            </p>
            <div className="usage-bar" style={{ marginTop: 14 }}>
              <div className="usage-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="usage-text">
              {summary.evidence_count} de {minimumEvidence} evidencias mínimas
            </div>
          </div>
        )}

        {learnings.length > 0 && (
          <div className="pattern-grid">
            {learnings.map((learning) => (
              <div className="pattern-card" key={learning.id}>
                <div className="pattern-ic">{trendIcon(learning.tendencia)}</div>
                <div className="pattern-title">{learning.patron}</div>
                <div className="conf-row">
                  <span className="conf-label">{Math.round(Number(learning.confianza) * 100)}% confianza</span>
                  <div className="conf-bar">
                    <div className="conf-fill" style={{ width: `${Math.round(Number(learning.confianza) * 100)}%` }} />
                  </div>
                </div>
                <div className="pattern-meta">
                  {learning.evidence_count} evidencias ({learning.positive_count} positivas · {learning.negative_count} negativas)
                  {learning.last_observed_at ? ` · Observado ${formatDate(learning.last_observed_at)}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .learn-spin {
          animation: spin 800ms linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

function formatConfidence(value: number | null) {
  return value === null ? "—" : `${Math.round(Number(value) * 100)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
