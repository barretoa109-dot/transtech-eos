"use client";

import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type LongitudinalState =
  | "new"
  | "strengthening"
  | "weakening"
  | "contradictory"
  | "stable"
  | "stale";

type LearningSnapshot = {
  snapshot_day: string;
  confianza: number;
  evidence_count: number;
  positive_count: number;
  negative_count: number;
};

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
  snapshot_count: number;
  first_confidence: number;
  latest_confidence: number;
  confidence_delta: number;
  evidence_delta: number;
  days_since_observed: number | null;
  contradictory: boolean;
  longitudinal_state: LongitudinalState;
  history: LearningSnapshot[];
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

const STATE_COPY: Record<
  LongitudinalState,
  { label: string; description: string }
> = {
  new: {
    label: "Nuevo",
    description: "Todavía necesita más observaciones para confirmar su estabilidad.",
  },
  strengthening: {
    label: "Se fortalece",
    description: "La confianza aumentó a medida que EOS acumuló nueva evidencia.",
  },
  weakening: {
    label: "Se debilita",
    description: "La evidencia reciente redujo la confianza en este patrón.",
  },
  contradictory: {
    label: "Contradictorio",
    description: "Hay evidencia relevante a favor y en contra del mismo patrón.",
  },
  stable: {
    label: "Estable",
    description: "El patrón se mantiene consistente con la evidencia acumulada.",
  },
  stale: {
    label: "Obsoleto",
    description: "Hace más de 90 días que EOS no observa evidencia nueva.",
  },
};

export default function LearningsView() {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [longitudinalSummary, setLongitudinalSummary] = useState<
    Record<string, number>
  >({});
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
      setLongitudinalSummary(payload.longitudinal_summary ?? {});
      setMinimumEvidence(payload.minimum_evidence ?? 3);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No pudimos cargar los aprendizajes.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const progress = Math.min(
    100,
    Math.round((summary.evidence_count / minimumEvidence) * 100),
  );
  const strengthening = longitudinalSummary.strengthening ?? 0;
  const attention =
    (longitudinalSummary.weakening ?? 0) +
    (longitudinalSummary.contradictory ?? 0) +
    (longitudinalSummary.stale ?? 0);

  return (
    <main className="learning-page">
      <div className="learning-container">
        <header className="learning-header">
          <div>
            <span className="eyebrow">
              <BrainCircuit size={15} /> INTELIGENCIA ACUMULATIVA
            </span>
            <h1>Aprendizaje longitudinal</h1>
            <p>
              EOS no solo recuerda patrones: ahora mide cómo cambia su confianza
              cuando aparecen resultados nuevos a lo largo del tiempo.
            </p>
          </div>
          <button className="refresh" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} /> {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </header>

        <section className="metrics">
          <Metric
            icon={<Sparkles size={20} />}
            value={summary.active_learnings}
            label="Patrones aprendidos"
          />
          <Metric
            icon={<ShieldCheck size={20} />}
            value={summary.evidence_count}
            label="Evidencias válidas"
          />
          <Metric
            icon={<TrendingUp size={20} />}
            value={strengthening}
            label="Se fortalecen"
          />
          <Metric
            icon={<AlertTriangle size={20} />}
            value={attention}
            label="Requieren revisión"
          />
        </section>

        {error ? <div className="error">{error}</div> : null}

        {!loading && !summary.eligible ? (
          <section className="collecting-card">
            <div className="collecting-icon">
              <Clock3 size={27} />
            </div>
            <div className="collecting-copy">
              <span>RECOPILANDO EVIDENCIA</span>
              <h2>EOS todavía no tiene resultados suficientes para aprender</h2>
              <p>
                Necesita al menos {minimumEvidence} resultados verificables.
                Actualmente hay {summary.evidence_count}. Las decisiones sin
                resultado no se usan para inferir patrones.
              </p>
              <div className="progress-track">
                <div style={{ width: `${progress}%` }} />
              </div>
              <small>
                {summary.evidence_count} de {minimumEvidence} evidencias mínimas
              </small>
            </div>
          </section>
        ) : null}

        {learnings.length > 0 ? (
          <section className="learning-list">
            {learnings.map((learning) => {
              const longitudinal =
                STATE_COPY[learning.longitudinal_state] ?? STATE_COPY.new;
              const delta = Number(learning.confidence_delta || 0);

              return (
                <article className="learning-card" key={learning.id}>
                  <div className="card-heading">
                    <div
                      className={`longitudinal longitudinal-${learning.longitudinal_state}`}
                    >
                      {learning.longitudinal_state === "strengthening" ? (
                        <TrendingUp size={17} />
                      ) : learning.longitudinal_state === "weakening" ? (
                        <TrendingDown size={17} />
                      ) : learning.longitudinal_state === "contradictory" ||
                        learning.longitudinal_state === "stale" ? (
                        <AlertTriangle size={17} />
                      ) : (
                        <BrainCircuit size={17} />
                      )}
                      {longitudinal.label}
                    </div>
                    <span className="confidence">
                      {Math.round(Number(learning.confianza) * 100)}% confianza
                    </span>
                  </div>

                  <span className="category">{learning.categoria}</span>
                  <h2>{learning.patron}</h2>

                  <div className="evolution-copy">
                    <strong>{longitudinal.description}</strong>
                    <span>
                      Confianza {formatDelta(delta)} · Evidencia +
                      {Number(learning.evidence_delta || 0)}
                    </span>
                  </div>

                  {learning.history?.length > 0 ? (
                    <div className="history-strip" aria-label="Evolución de confianza">
                      {learning.history.slice(-12).map((snapshot) => (
                        <span
                          key={`${learning.id}-${snapshot.snapshot_day}`}
                          title={`${snapshot.snapshot_day}: ${Math.round(
                            Number(snapshot.confianza) * 100,
                          )}%`}
                          style={{
                            height: `${Math.max(
                              12,
                              Math.round(Number(snapshot.confianza) * 42),
                            )}px`,
                          }}
                        />
                      ))}
                    </div>
                  ) : null}

                  <div className="recommendation">
                    <small>RECOMENDACIÓN APRENDIDA</small>
                    <p>{learning.recomendacion}</p>
                  </div>

                  <footer>
                    <span>{learning.evidence_count} evidencias</span>
                    <span>
                      {learning.positive_count} positivas · {learning.negative_count}{" "}
                      negativas
                    </span>
                    {learning.last_observed_at ? (
                      <span>Observado {formatDate(learning.last_observed_at)}</span>
                    ) : null}
                    {learning.days_since_observed !== null ? (
                      <span>{learning.days_since_observed} días desde última señal</span>
                    ) : null}
                  </footer>
                </article>
              );
            })}
          </section>
        ) : null}
      </div>

      <style jsx>{`
        .learning-page{min-height:100%;padding:38px 28px 70px;background:radial-gradient(circle at 82% 8%,rgba(37,99,235,.11),transparent 28%),linear-gradient(145deg,#ffffff 0%,#f7faff 52%,#eef5ff 100%);color:#071226;font-family:Inter,Arial,Helvetica,sans-serif}.learning-container{max-width:1180px;margin:auto}.learning-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.eyebrow{display:flex;align-items:center;gap:8px;color:#2563eb;font-size:11px;font-weight:900;letter-spacing:.14em}.learning-header h1{margin:12px 0 8px;font-size:38px;font-weight:900;letter-spacing:-.04em}.learning-header p{max-width:730px;margin:0;color:#64748b;line-height:1.6}.refresh{display:flex;align-items:center;gap:8px;border:1px solid #dbeafe;border-radius:12px;background:rgba(255,255,255,.9);color:#2563eb;padding:12px 16px;font-family:inherit;font-weight:800;box-shadow:0 9px 24px rgba(37,99,235,.08);cursor:pointer}.refresh:disabled{opacity:.65;cursor:wait}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:30px 0}.error{margin-bottom:18px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#b91c1c;padding:13px 16px}.collecting-card{display:grid;grid-template-columns:auto 1fr;gap:20px;border:1px solid rgba(148,163,184,.2);border-radius:22px;background:rgba(255,255,255,.92);box-shadow:0 20px 60px rgba(15,23,42,.07);padding:28px}.collecting-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:17px;background:#eff6ff;color:#2563eb}.collecting-copy>span,.recommendation small{font-size:10px;font-weight:900;letter-spacing:.13em;color:#2563eb}.collecting-copy h2{margin:8px 0;color:#071226;font-size:22px;font-weight:900}.collecting-copy p{max-width:760px;color:#64748b;line-height:1.55}.progress-track{height:8px;margin:18px 0 8px;border-radius:999px;background:#e9eff8;overflow:hidden}.progress-track div{height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#60a5fa);box-shadow:0 0 18px rgba(37,99,235,.3)}.collecting-copy small{color:#94a3b8}.learning-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.learning-card{border:1px solid rgba(148,163,184,.2);border-radius:20px;background:rgba(255,255,255,.92);box-shadow:0 17px 48px rgba(15,23,42,.065);padding:22px}.card-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}.longitudinal{display:flex;align-items:center;gap:7px;border-radius:999px;padding:6px 10px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:900;text-transform:uppercase}.longitudinal-strengthening{background:#ecfdf5;color:#15803d}.longitudinal-weakening,.longitudinal-stale{background:#fff7ed;color:#c2410c}.longitudinal-contradictory{background:#fef2f2;color:#dc2626}.longitudinal-new{background:#eff6ff;color:#2563eb}.confidence{color:#64748b;font-size:12px}.category{display:block;margin-top:18px;color:#2563eb;font-size:10px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.learning-card h2{margin:8px 0 14px;color:#071226;font-size:20px;font-weight:900;line-height:1.4}.evolution-copy{display:grid;gap:5px;margin-bottom:13px;border-radius:11px;background:#f8fafc;padding:11px 13px}.evolution-copy strong{color:#475569;font-size:11px;line-height:1.45}.evolution-copy span{color:#64748b;font-size:10px}.history-strip{height:48px;display:flex;align-items:flex-end;gap:4px;margin:4px 0 15px;padding:0 3px;border-bottom:1px solid #dbeafe}.history-strip span{width:8px;border-radius:4px 4px 0 0;background:linear-gradient(180deg,#60a5fa,#2563eb);opacity:.85}.recommendation{border-left:3px solid #2563eb;border-radius:8px;background:#eff6ff;padding:13px 15px}.recommendation p{margin:7px 0 0;color:#475569;line-height:1.55}.learning-card footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px;color:#64748b;font-size:11px}@media(max-width:850px){.learning-page{padding:26px 16px 60px}.learning-header{display:grid}.refresh{width:100%;justify-content:center}.metrics{grid-template-columns:repeat(2,1fr)}.learning-list{grid-template-columns:1fr}.learning-header h1{font-size:30px}.collecting-card{grid-template-columns:1fr}}@media(max-width:480px){.metrics{grid-template-columns:1fr}}
      `}</style>
    </main>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <article className="metric">
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
      <style jsx>{`
        .metric{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:center;border:1px solid rgba(148,163,184,.2);border-radius:16px;background:rgba(255,255,255,.92);box-shadow:0 14px 38px rgba(15,23,42,.055);padding:18px}.metric span{grid-row:1/3;color:#2563eb}.metric strong{color:#071226;font-size:25px;font-weight:900}.metric small{color:#64748b}
      `}</style>
    </article>
  );
}

function formatDelta(value: number) {
  const points = Math.round(value * 100);
  if (points === 0) return "sin cambio";
  return `${points > 0 ? "+" : ""}${points} pp`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
