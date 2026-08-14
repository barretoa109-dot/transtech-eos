"use client";

import { ArrowRight, BarChart3, TrendingUp } from "lucide-react";

export type IntelligenceTrendDirection = "up" | "down" | "stable" | "new";

export type IntelligenceDriver = {
  key: string;
  label: string;
  delta: number;
  impact: "positivo" | "negativo";
};

export type IntelligenceScore = {
  score: number;
  dimensions: Record<
    "contexto" | "objetivos" | "ejecucion" | "decisiones" | "aprendizaje",
    number
  >;
  explanation: {
    summary: string;
    next_action: string;
  };
  trend: {
    direction: IntelligenceTrendDirection;
    delta: number;
    summary: string;
    drivers: IntelligenceDriver[];
    previous_day: string | null;
    previous_score: number | null;
  };
  history: Array<{ day: string; score: number }>;
  calculated_at?: string;
};

type IntelligenceScoreCardProps = {
  intelligence: IntelligenceScore;
  onOpenChat?: () => void;
};

export default function IntelligenceScoreCard({
  intelligence,
  onOpenChat,
}: IntelligenceScoreCardProps) {
  const dimensions = Object.entries(intelligence.dimensions);

  return (
    <section className="intelligence-card">
      <div className="intelligence-heading">
        <div>
          <div className="intelligence-title-row">
            <span className="intelligence-label">EOS INTELLIGENCE SCORE</span>
            <span
              className={`intelligence-trend is-${intelligence.trend.direction}`}
            >
              {trendDirectionLabel(intelligence.trend.direction)}
              {intelligence.trend.direction !== "new" && (
                <strong>{formatSignedDelta(intelligence.trend.delta)} pts</strong>
              )}
            </span>
          </div>

          <h2>Por qué tu score es {intelligence.score}</h2>
          <p>{intelligence.explanation.summary}</p>

          {intelligence.calculated_at && (
            <span className="intelligence-updated">
              Medición semántica {formatScoreTimestamp(intelligence.calculated_at)}
            </span>
          )}
        </div>

        {onOpenChat && (
          <button type="button" onClick={onOpenChat}>
            Mejorar mi score <ArrowRight size={15} />
          </button>
        )}
      </div>

      <div className="dimension-grid">
        {dimensions.map(([name, value]) => (
          <div className="dimension-item" key={name}>
            <div>
              <span>{capitalizar(name)}</span>
              <strong>{value}</strong>
            </div>
            <div className="dimension-track">
              <span style={{ width: `${clamp(value)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="intelligence-analysis-grid">
        <article className="intelligence-trend-card">
          <div className="intelligence-subheading">
            <TrendingUp size={18} />
            <div>
              <span>EVOLUCIÓN</span>
              <strong>Qué cambió y por qué</strong>
            </div>
          </div>

          <p>{intelligence.trend.summary}</p>

          {intelligence.trend.drivers.length > 0 ? (
            <div className="intelligence-drivers">
              {intelligence.trend.drivers.map((driver) => (
                <div
                  className={`intelligence-driver is-${driver.impact}`}
                  key={`${driver.key}-${driver.delta}`}
                >
                  <span>{driver.label}</span>
                  <strong>{formatSignedDelta(driver.delta)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="intelligence-baseline">
              EOS necesita al menos dos mediciones comparables para aislar los
              factores que movieron tu score.
            </p>
          )}
        </article>

        <article className="intelligence-history-card">
          <div className="intelligence-subheading">
            <BarChart3 size={18} />
            <div>
              <span>HISTORIAL</span>
              <strong>Últimas mediciones comparables</strong>
            </div>
          </div>

          {intelligence.history.length > 0 ? (
            <div
              className="score-history"
              aria-label="Historial del EOS Intelligence Score"
            >
              {intelligence.history.map((point) => (
                <div
                  className="score-history-point"
                  key={point.day}
                  title={`${formatScoreDay(point.day)} · ${point.score} puntos`}
                >
                  <strong>{point.score}</strong>
                  <div className="score-history-track">
                    <span style={{ height: `${scoreBarHeight(point.score)}%` }} />
                  </div>
                  <small>{formatScoreDay(point.day)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="intelligence-baseline">
              El historial aparecerá cuando EOS complete tu primera medición
              persistida.
            </p>
          )}
        </article>
      </div>

      <p className="intelligence-next">
        <strong>Próxima mejora:</strong> {intelligence.explanation.next_action}
      </p>

      <style jsx>{`
        .intelligence-card {
          margin: 22px 0;
          padding: 27px;
          border: 1px solid #dbeafe;
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 20px 60px rgba(37, 99, 235, 0.07);
        }

        .intelligence-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
        }

        .intelligence-title-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .intelligence-label {
          color: #2563eb;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .intelligence-heading h2 {
          margin: 8px 0 0;
          color: #071226;
          font-size: 26px;
          letter-spacing: -0.035em;
        }

        .intelligence-heading p {
          max-width: 680px;
          margin: 8px 0 0;
          color: #64748b;
          font-size: 11px;
          line-height: 1.65;
        }

        .intelligence-heading button {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 38px;
          padding: 0 14px;
          border: 0;
          border-radius: 999px;
          background: #2563eb;
          color: white;
          font: 800 9px inherit;
          cursor: pointer;
        }

        .intelligence-trend {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 8px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #475569;
          font-size: 8px;
          font-weight: 850;
        }

        .intelligence-trend.is-up {
          background: #ecfdf5;
          color: #047857;
        }

        .intelligence-trend.is-down {
          background: #fff7ed;
          color: #c2410c;
        }

        .intelligence-trend.is-stable {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .intelligence-trend strong {
          font-size: 9px;
        }

        .intelligence-updated {
          display: block;
          margin-top: 8px;
          color: #94a3b8;
          font-size: 8px;
          font-weight: 700;
        }

        .dimension-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          margin-top: 22px;
        }

        .dimension-item {
          padding: 14px;
          border-radius: 16px;
          background: #f8fafc;
        }

        .dimension-item > div:first-child {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          color: #475569;
          font-size: 9px;
          font-weight: 800;
        }

        .dimension-item strong {
          color: #071226;
          font-size: 15px;
        }

        .dimension-track {
          height: 6px;
          margin-top: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .dimension-track span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #2563eb, #60a5fa);
        }

        .intelligence-analysis-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
          gap: 14px;
          margin-top: 14px;
        }

        .intelligence-trend-card,
        .intelligence-history-card {
          min-width: 0;
          padding: 17px;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #fff;
        }

        .intelligence-subheading {
          display: flex;
          align-items: center;
          gap: 9px;
          color: #2563eb;
        }

        .intelligence-subheading > div {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .intelligence-subheading span {
          color: #94a3b8;
          font-size: 7px;
          font-weight: 900;
          letter-spacing: 0.12em;
        }

        .intelligence-subheading strong {
          color: #0f172a;
          font-size: 10px;
        }

        .intelligence-trend-card > p {
          margin: 12px 0 0;
          color: #475569;
          font-size: 10px;
          line-height: 1.6;
        }

        .intelligence-drivers {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 13px;
        }

        .intelligence-driver {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 9px 10px;
          border-radius: 12px;
          background: #f8fafc;
          color: #475569;
          font-size: 8px;
          font-weight: 750;
        }

        .intelligence-driver.is-positivo strong {
          color: #047857;
        }

        .intelligence-driver.is-negativo strong {
          color: #c2410c;
        }

        .intelligence-baseline {
          margin: 13px 0 0;
          color: #94a3b8;
          font-size: 9px;
          line-height: 1.55;
        }

        .score-history {
          display: flex;
          align-items: flex-end;
          gap: 6px;
          min-height: 128px;
          margin-top: 15px;
          overflow-x: auto;
          padding: 0 2px 3px;
        }

        .score-history-point {
          display: grid;
          grid-template-rows: auto 86px auto;
          justify-items: center;
          gap: 5px;
          min-width: 30px;
          flex: 1;
        }

        .score-history-point > strong {
          color: #334155;
          font-size: 8px;
        }

        .score-history-track {
          position: relative;
          width: 9px;
          height: 86px;
          overflow: hidden;
          border-radius: 999px;
          background: #eef2f7;
        }

        .score-history-track span {
          position: absolute;
          right: 0;
          bottom: 0;
          left: 0;
          min-height: 6px;
          border-radius: 999px;
          background: linear-gradient(180deg, #60a5fa, #2563eb);
        }

        .score-history-point small {
          color: #94a3b8;
          font-size: 7px;
          white-space: nowrap;
        }

        .intelligence-next {
          margin: 17px 0 0;
          padding: 11px 13px;
          border-radius: 13px;
          background: #eff6ff;
          color: #1d4ed8;
          font-size: 10px;
        }

        @media (max-width: 980px) {
          .dimension-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .intelligence-analysis-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .intelligence-heading {
            flex-direction: column;
          }

          .intelligence-heading button {
            width: 100%;
            justify-content: center;
          }

          .dimension-grid,
          .intelligence-drivers {
            grid-template-columns: 1fr;
          }

          .score-history {
            gap: 4px;
          }

          .score-history-point {
            min-width: 28px;
          }
        }
      `}</style>
    </section>
  );
}

function trendDirectionLabel(direction: IntelligenceTrendDirection) {
  if (direction === "up") return "Subiendo";
  if (direction === "down") return "Bajando";
  if (direction === "stable") return "Estable";
  return "Nueva base";
}

function formatSignedDelta(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function formatScoreTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "actualizada";

  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatScoreDay(value: string) {
  const [, month = "", day = ""] = value.split("-");
  if (!month || !day) return value;
  return `${day}/${month}`;
}

function scoreBarHeight(value: number) {
  return Math.max(18, clamp(value));
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function capitalizar(value: string) {
  const limpio = value.trim();
  if (!limpio) return value;
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
}
