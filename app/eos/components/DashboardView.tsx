"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Lightbulb, Target, TrendingDown, TrendingUp } from "lucide-react";
import type { Briefing } from "../types/briefing";

type DashboardViewProps = {
  briefing: Briefing;
  briefingHistory: Briefing[];
  plan: string;
  totalConversations: number;
  totalMessages: number;
  onOpenChat: () => void;
};

type PeriodoKey = "mes" | "trimestre" | "anio";

/** Equivalente real a los chips "Este mes / Último trimestre / Año" de la maqueta:
 *  acotan la ventana del histórico de briefings que se grafica. */
const PERIODOS: { key: PeriodoKey; label: string; dias: number }[] = [
  { key: "mes", label: "Este mes", dias: 30 },
  { key: "trimestre", label: "Último trimestre", dias: 90 },
  { key: "anio", label: "Año", dias: 365 },
];

export default function DashboardView({
  briefing,
  briefingHistory,
  totalConversations,
  totalMessages,
  onOpenChat,
}: DashboardViewProps) {
  const fuentes = briefing.fuentes ?? {};

  const prioridades = [briefing.prioridad_1, briefing.prioridad_2, briefing.prioridad_3].filter(
    (p): p is string => Boolean(p && p.trim()),
  );

  // La maqueta muestra varias recomendaciones; acá las adicionales salen de
  // los riesgos reales que detectó el briefing, no de texto inventado.
  const riesgos = (briefing.riesgos ?? []).filter((r) => r?.titulo?.trim()).slice(0, 2);

  const [completadas, setCompletadas] = useState<Record<number, boolean>>({});
  const [periodo, setPeriodo] = useState<PeriodoKey>("mes");

  const puntosGrafico = useMemo(() => {
    const dias = PERIODOS.find((p) => p.key === periodo)?.dias ?? 30;
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);

    return [...briefingHistory]
      .filter((b) => typeof b.score === "number" && b.briefing_date)
      .filter((b) => new Date(`${b.briefing_date}T12:00:00-03:00`) >= desde)
      .sort((a, b) => (a.briefing_date! < b.briefing_date! ? -1 : 1))
      .map((b) => ({ fecha: b.briefing_date!, score: b.score ?? 0 }));
  }, [briefingHistory, periodo]);

  return (
    <div className="view" id="view-dashboard">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Dashboard</div>
          <div className="page-title">Centro de control</div>
          <div className="page-sub">Métricas, prioridades y recomendaciones en un solo lugar.</div>
        </div>

        <div className="chip-row">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`chip ${periodo === p.key ? "active" : ""}`}
              onClick={() => setPeriodo(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="kpi-grid">
          <div className="kpi-card" style={{ animationDelay: ".04s" }}>
            <div className="l">EOS Score</div>
            <div className="v">{briefing.score ?? 0}</div>
            <div className={`d ${(briefing.score ?? 0) >= 50 ? "up" : "warn"}`}>
              {(briefing.score ?? 0) >= 50 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              sobre 100
            </div>
          </div>
          <div className="kpi-card" style={{ animationDelay: ".09s" }}>
            <div className="l">Objetivos activos</div>
            <div className="v">{fuentes.objetivos_activos ?? 0}</div>
            <div className="d">&nbsp;</div>
          </div>
          <div className="kpi-card" style={{ animationDelay: ".14s" }}>
            <div className="l">Progreso promedio</div>
            <div className="v">{fuentes.progreso_promedio ?? 0}%</div>
            <div className="d">&nbsp;</div>
          </div>
          <div className="kpi-card" style={{ animationDelay: ".19s" }}>
            <div className="l">Tareas pendientes</div>
            <div className="v">{fuentes.tareas_pendientes ?? 0}</div>
            <div className={`d ${(fuentes.acciones_con_error ?? 0) > 0 ? "warn" : ""}`}>
              {(fuentes.acciones_con_error ?? 0) > 0 ? `⚠ ${fuentes.acciones_con_error} con error` : ""}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="chart-head">
            <div>
              <div className="card-title">Evolución del EOS Score</div>
              <div className="card-sub" style={{ marginBottom: 0 }}>
                Últimos briefings
              </div>
            </div>
            <div className="chart-legend">
              <span className="sw" /> Score
            </div>
          </div>
          {puntosGrafico.length >= 2 ? (
            <ScoreChart puntos={puntosGrafico} />
          ) : (
            <div className="chart-empty">Todavía no hay suficiente historial para graficar la evolución.</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Prioridades de hoy</div>
          <div className="card-sub">{prioridades.length} del briefing de EOS</div>
          {prioridades.length === 0 ? (
            <p className="empty-note">Todavía no hay prioridades generadas.</p>
          ) : (
            <div className="priority-list">
              {prioridades.map((texto, i) => (
                <div className="priority-item" key={i}>
                  <button
                    type="button"
                    className={`p-check ${completadas[i] ? "done" : ""}`}
                    onClick={() => setCompletadas((actual) => ({ ...actual, [i]: !actual[i] }))}
                    aria-label={completadas[i] ? "Marcar como pendiente" : "Marcar como completada"}
                  >
                    {completadas[i] && <Check size={12} />}
                  </button>
                  <div className="p-text">{texto}</div>
                  <div className={`p-tag ${i === 0 ? "alta" : i === 1 ? "media" : "baja"}`}>
                    {i === 0 ? "Alta" : i === 1 ? "Media" : "Normal"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Recomendaciones de EOS</div>
          <div className="card-sub">Basadas en tu actividad reciente</div>

          <div className="reco">
            <div className="ric">
              <Lightbulb size={16} />
            </div>
            <div>
              <div className="rt">{briefing.recomendacion_principal}</div>
              <div className="rs">
                {totalConversations} conversaciones · {totalMessages} mensajes intercambiados con EOS.
              </div>
              <button type="button" className="reco-btn" onClick={onOpenChat}>
                <Target size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
                Conversar con EOS
              </button>
            </div>
          </div>

          {riesgos.map((riesgo, i) => (
            <div className="reco" key={`riesgo-${i}`}>
              <div className="ric" style={{ background: "var(--amber-light)", color: "var(--amber)" }}>
                <AlertTriangle size={16} />
              </div>
              <div>
                <div className="rt">{riesgo.titulo}</div>
                {riesgo.descripcion && <div className="rs">{riesgo.descripcion}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScoreChart({ puntos }: { puntos: { fecha: string; score: number }[] }) {
  const W = 640;
  const H = 200;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 26;

  const min = Math.min(...puntos.map((p) => p.score)) * 0.85;
  const max = Math.max(...puntos.map((p) => p.score)) * 1.08 || 100;
  const x = (i: number) => padL + (i / (puntos.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);

  const linePath = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const areaPath = `M${x(0)},${H - padB} L${puntos
    .map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`)
    .join(" L")} L${x(puntos.length - 1)},${H - padB} Z`;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="eosAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1656bd" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#1656bd" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2].map((g) => {
        const gy = padT + (g / 2) * (H - padT - padB);
        return <line key={g} className="grid-line" x1={padL} y1={gy} x2={W - padR} y2={gy} />;
      })}
      <path className="area-fill" d={areaPath} />
      <path className="line-path" d={linePath} />
      {puntos.map((p, i) => {
        const isLast = i === puntos.length - 1;
        return <circle key={i} className={`dot ${isLast ? "last" : ""}`} cx={x(i)} cy={y(p.score)} r={isLast ? 5 : 3.5} />;
      })}
      {puntos.map((p, i) => (
        <text key={`label-${i}`} className="axis-label" x={x(i)} y={H - 6} textAnchor="middle">
          {new Date(p.fecha).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
        </text>
      ))}
      <text
        className="val-label"
        x={x(puntos.length - 1) - 4}
        y={y(puntos[puntos.length - 1].score) - 12}
        textAnchor="end"
      >
        {puntos[puntos.length - 1].score}
      </text>
    </svg>
  );
}
