"use client";

import {
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
    <main className="learning-page">
      <div className="learning-container">
        <header className="learning-header">
          <div>
            <span className="eyebrow"><BrainCircuit size={15} /> INTELIGENCIA ACUMULATIVA</span>
            <h1>Aprendizaje de resultados</h1>
            <p>EOS contrasta decisiones, objetivos y ejecuciones para recomendar con evidencia, no con suposiciones.</p>
          </div>
          <button className="refresh" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} /> {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </header>

        <section className="metrics">
          <Metric icon={<Sparkles size={20} />} value={summary.active_learnings} label="Patrones aprendidos" />
          <Metric icon={<ShieldCheck size={20} />} value={summary.evidence_count} label="Evidencias válidas" />
          <Metric icon={<CheckCircle2 size={20} />} value={formatConfidence(summary.average_confidence)} label="Confianza media" />
          <Metric icon={<BrainCircuit size={20} />} value={summary.evidence_type_count} label="Tipos de evidencia" />
        </section>

        {error ? <div className="error">{error}</div> : null}

        {!loading && !summary.eligible ? (
          <section className="collecting-card">
            <div className="collecting-icon"><Clock3 size={27} /></div>
            <div className="collecting-copy">
              <span>RECOPILANDO EVIDENCIA</span>
              <h2>EOS todavía no tiene resultados suficientes para aprender</h2>
              <p>Necesita al menos {minimumEvidence} resultados verificables. Actualmente hay {summary.evidence_count}. Las decisiones sin resultado no se usan para inferir patrones.</p>
              <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>
              <small>{summary.evidence_count} de {minimumEvidence} evidencias mínimas</small>
            </div>
          </section>
        ) : null}

        {learnings.length > 0 ? (
          <section className="learning-list">
            {learnings.map((learning) => (
              <article className="learning-card" key={learning.id}>
                <div className="card-heading">
                  <div className={`trend trend-${learning.tendencia}`}>
                    {learning.tendencia === "positiva" ? <TrendingUp size={18} /> : learning.tendencia === "negativa" ? <TrendingDown size={18} /> : <BrainCircuit size={18} />}
                    {learning.tendencia}
                  </div>
                  <span className="confidence">{Math.round(Number(learning.confianza) * 100)}% confianza</span>
                </div>
                <span className="category">{learning.categoria}</span>
                <h2>{learning.patron}</h2>
                <div className="recommendation"><small>RECOMENDACIÓN APRENDIDA</small><p>{learning.recomendacion}</p></div>
                <footer>
                  <span>{learning.evidence_count} evidencias</span>
                  <span>{learning.positive_count} positivas · {learning.negative_count} negativas</span>
                  {learning.last_observed_at ? <span>Observado {formatDate(learning.last_observed_at)}</span> : null}
                </footer>
              </article>
            ))}
          </section>
        ) : null}
      </div>

      <style jsx>{`
        .learning-page{min-height:100%;padding:38px 28px 70px;background:radial-gradient(circle at 82% 8%,rgba(124,58,237,.16),transparent 28%),#07111f;color:#e8f0fb}.learning-container{max-width:1180px;margin:auto}.learning-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.eyebrow{display:flex;align-items:center;gap:8px;color:#a78bfa;font-size:11px;font-weight:900;letter-spacing:.14em}.learning-header h1{margin:12px 0 8px;font-size:38px;letter-spacing:-.04em}.learning-header p{max-width:710px;margin:0;color:#94a3b8;line-height:1.6}.refresh{display:flex;align-items:center;gap:8px;border:1px solid #30415a;border-radius:12px;background:#111f32;color:#d4deeb;padding:12px 16px;font-weight:800;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:30px 0}.error{margin-bottom:18px;border:1px solid #7f1d1d;border-radius:12px;background:#43191d;color:#fecaca;padding:13px 16px}.collecting-card{display:grid;grid-template-columns:auto 1fr;gap:20px;border:1px solid #34425a;border-radius:22px;background:linear-gradient(135deg,rgba(21,31,51,.96),rgba(13,24,42,.96));padding:28px}.collecting-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:17px;background:#2e1d57;color:#c4b5fd}.collecting-copy>span,.recommendation small{font-size:10px;font-weight:900;letter-spacing:.13em;color:#a78bfa}.collecting-copy h2{margin:8px 0;font-size:22px}.collecting-copy p{max-width:760px;color:#a8b6c8;line-height:1.55}.progress-track{height:8px;margin:18px 0 8px;border-radius:999px;background:#1b2a3f;overflow:hidden}.progress-track div{height:100%;border-radius:inherit;background:linear-gradient(90deg,#7c3aed,#38bdf8)}.collecting-copy small{color:#7f91a8}.learning-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.learning-card{border:1px solid #273954;border-radius:20px;background:#0e1b2d;padding:22px}.card-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}.trend{display:flex;align-items:center;gap:7px;border-radius:999px;padding:6px 10px;background:#18273c;color:#cbd5e1;font-size:11px;font-weight:900;text-transform:uppercase}.trend-positiva{background:#103226;color:#86efac}.trend-negativa{background:#3c171c;color:#fca5a5}.confidence{color:#8da0b7;font-size:12px}.category{display:block;margin-top:18px;color:#60a5fa;font-size:10px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.learning-card h2{font-size:20px;line-height:1.4;margin:8px 0 17px}.recommendation{border-left:3px solid #8b5cf6;border-radius:8px;background:#091626;padding:13px 15px}.recommendation p{margin:7px 0 0;color:#b9c6d6;line-height:1.55}.learning-card footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px;color:#778aa2;font-size:11px}.metric{border:1px solid #253750;border-radius:16px;background:#0e1b2d;padding:18px}@media(max-width:850px){.learning-page{padding:26px 16px 60px}.learning-header{display:grid}.refresh{width:100%;justify-content:center}.metrics{grid-template-columns:repeat(2,1fr)}.learning-list{grid-template-columns:1fr}.learning-header h1{font-size:30px}.collecting-card{grid-template-columns:1fr}}@media(max-width:480px){.metrics{grid-template-columns:1fr}}
      `}</style>
    </main>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return <article className="metric"><span>{icon}</span><strong>{value}</strong><small>{label}</small><style jsx>{`.metric{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:center}.metric span{grid-row:1/3;color:#a78bfa}.metric strong{font-size:24px}.metric small{color:#8ea0b6}`}</style></article>;
}

function formatConfidence(value: number | null) {
  return value === null ? "—" : `${Math.round(Number(value) * 100)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
