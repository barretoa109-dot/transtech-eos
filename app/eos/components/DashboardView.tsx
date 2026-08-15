"use client";

import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

import PlanUsageCard from "./PlanUsageCard";
import { useEffect, useState } from "react";

type IntelligenceScore = {
  score: number;
  dimensions: Record<"contexto" | "objetivos" | "ejecucion" | "decisiones" | "aprendizaje", number>;
  explanation: { summary: string; next_action: string };
  trend: {
    direction: "new" | "up" | "down" | "stable";
    delta: number;
    summary: string;
    drivers: Array<{
      key: string;
      label: string;
      delta: number;
      impact: "positivo" | "negativo";
    }>;
    previous_day: string | null;
    previous_score: number | null;
  };
  history: Array<{ day: string; score: number }>;
  persistence: {
    snapshot_persisted: boolean;
    history_loaded: boolean;
    writer: "server";
  };
  calculated_at: string;
};

type DashboardViewProps = {
  // Propiedades usadas actualmente por app/eos/chat/page.tsx
  score?: number;
  conversaciones?: number;
  mensajes?: number;
  plan?: string;
  ultimoChat?: string | null;

  // Compatibilidad con la versión anterior
  userName: string;
  totalConversations?: number;
  totalMessages?: number;
  activeObjectives?: number;
  generatedDocuments?: number;
  eosScore?: number;
  onOpenChat?: () => void;
};

type MetricProps = {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description: string;
};

type InsightProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "blue" | "green" | "amber";
};

export default function DashboardView({
  score,
  conversaciones,
  mensajes,
  plan = "free",
  ultimoChat,
  userName,
  totalConversations,
  totalMessages,
  activeObjectives = 0,
  generatedDocuments = 0,
  eosScore,
  onOpenChat,
}: DashboardViewProps) {
  const [intelligence, setIntelligence] = useState<IntelligenceScore | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/eos-kpis", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data?.dimensions) setIntelligence(data); })
      .catch((error) => console.error("No se pudo cargar EOS Intelligence Score:", error));
    return () => { active = false; };
  }, []);

  const scoreVisible = normalizarPorcentaje(
    intelligence?.score ?? score ?? eosScore ?? 0,
  );

  const conversacionesVisibles =
    conversaciones ?? totalConversations ?? 0;

  const mensajesVisibles =
    mensajes ?? totalMessages ?? 0;

  const progresoSemanal = calcularProgreso(
    scoreVisible,
    conversacionesVisibles,
    mensajesVisibles,
  );

  const planVisible = capitalizar(plan);

  return (
    <main className="dashboard-page">
      <div className="dashboard-grid-pattern" />
      <div className="dashboard-glow dashboard-glow-one" />
      <div className="dashboard-glow dashboard-glow-two" />

      <div className="dashboard-container">
        <section className="dashboard-hero">
          <div className="dashboard-hero-copy">
            <div className="dashboard-eyebrow">
              <span className="dashboard-eyebrow-dot" />
              CENTRO DE CONTROL EOS
            </div>

            <h1>
              {obtenerSaludo()}, {obtenerPrimerNombre(userName)}.
            </h1>

            <p>
              EOS reúne tus conversaciones, actividad, objetivos y
              documentos para ofrecerte una visión clara del estado actual
              de tu espacio de trabajo.
            </p>

            <div className="dashboard-hero-actions">
              <button
                type="button"
                onClick={onOpenChat}
                className="dashboard-primary-button"
              >
                <MessageSquareText size={18} />
                Conversar con EOS
                <ArrowRight size={17} />
              </button>

              <span className="dashboard-plan-pill">
                <ShieldCheck size={15} />
                Plan {planVisible}
              </span>
            </div>
          </div>

          <ScoreRing
            value={scoreVisible}
            label="EOS Score"
          />
        </section>

        <PlanUsageCard />

        {intelligence && (
          <section className="intelligence-card">
            <div className="intelligence-heading">
              <div>
                <span className="dashboard-section-label">EOS INTELLIGENCE SCORE</span>
                <div className="intelligence-title-row">
                  <h2>Por qué tu score es {intelligence.score}</h2>
                  <span className={`intelligence-delta intelligence-delta-${intelligence.trend.direction}`}>
                    {intelligence.trend.direction === "new"
                      ? "Primera medición"
                      : `${intelligence.trend.delta > 0 ? "+" : ""}${intelligence.trend.delta} pts`}
                  </span>
                </div>
                <p>{intelligence.explanation.summary}</p>
              </div>
              <button type="button" onClick={onOpenChat}>Mejorar mi score <ArrowRight size={15} /></button>
            </div>

            <div className="dimension-grid">
              {Object.entries(intelligence.dimensions).map(([name, value]) => (
                <div className="dimension-item" key={name}>
                  <div><span>{capitalizar(name)}</span><strong>{value}</strong></div>
                  <div className="dimension-track"><span style={{ width: `${value}%` }} /></div>
                </div>
              ))}
            </div>

            <div className="intelligence-detail-grid">
              <article className="intelligence-trend-panel">
                <div className="intelligence-panel-heading">
                  <span>EVOLUCIÓN</span>
                  <strong>{intelligence.trend.previous_score === null ? "Base inicial" : `vs. ${intelligence.trend.previous_score}`}</strong>
                </div>
                <p>{intelligence.trend.summary}</p>
                {intelligence.trend.drivers.length > 0 ? (
                  <div className="intelligence-drivers">
                    {intelligence.trend.drivers.map((driver) => (
                      <span className={`intelligence-driver intelligence-driver-${driver.impact}`} key={`${driver.key}-${driver.delta}`}>
                        {driver.label} {driver.delta > 0 ? "+" : ""}{driver.delta}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="intelligence-neutral">EOS necesita otra medición comparable para explicar los cambios.</span>
                )}
              </article>

              <article className="intelligence-history-panel">
                <div className="intelligence-panel-heading">
                  <span>HISTORIAL</span>
                  <strong>{intelligence.history.length} registro{intelligence.history.length === 1 ? "" : "s"}</strong>
                </div>
                {intelligence.history.length > 0 ? (
                  <>
                    <div className="intelligence-history-bars" aria-label="Historial reciente del EOS Intelligence Score">
                      {intelligence.history.map((point) => (
                        <div className="intelligence-history-column" key={point.day} title={`${point.day}: ${point.score}`}>
                          <span className="intelligence-history-value">{point.score}</span>
                          <div className="intelligence-history-track">
                            <span style={{ height: `${Math.max(8, point.score)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="intelligence-history-range">
                      <span>{intelligence.history[0]?.day}</span>
                      <span>{intelligence.history[intelligence.history.length - 1]?.day}</span>
                    </div>
                  </>
                ) : (
                  <span className="intelligence-neutral">El historial aparecerá cuando exista un snapshot comparable.</span>
                )}
              </article>
            </div>

            <div className="intelligence-footer-row">
              <p className="intelligence-next"><strong>Próxima mejora:</strong> {intelligence.explanation.next_action}</p>
              <span className="intelligence-calculated">
                {intelligence.persistence.snapshot_persisted ? "Snapshot guardado" : "Cálculo no persistido"}
                {intelligence.calculated_at ? ` · ${new Date(intelligence.calculated_at).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short", timeZone: "America/Asuncion" })}` : ""}
              </span>
            </div>
          </section>
        )}

        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <span className="dashboard-section-label">
                RESUMEN OPERATIVO
              </span>

              <h2>Estado general de EOS</h2>
            </div>

            <div className="dashboard-system-status">
              <span className="dashboard-system-dot" />
              Sistema operativo
            </div>
          </div>

          <div className="dashboard-metrics-grid">
            <MetricCard
              icon={<MessageSquareText size={23} />}
              label="Conversaciones"
              value={conversacionesVisibles}
              description="Sesiones registradas"
            />

            <MetricCard
              icon={<Zap size={23} />}
              label="Mensajes"
              value={mensajesVisibles}
              description="Interacciones procesadas"
            />

            <MetricCard
              icon={<Target size={23} />}
              label="Objetivos activos"
              value={activeObjectives}
              description="En seguimiento actualmente"
            />

            <MetricCard
              icon={<FileSpreadsheet size={23} />}
              label="Documentos"
              value={generatedDocuments}
              description="Archivos generados"
            />
          </div>
        </section>

        <section className="dashboard-content-grid">
          <article className="dashboard-insights-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-section-label">
                  ANÁLISIS ACTUAL
                </span>

                <h2>EOS detectó hoy</h2>
              </div>

              <span className="dashboard-card-icon">
                <BrainCircuit size={22} />
              </span>
            </div>

            <div className="dashboard-insights-list">
              <InsightRow
                icon={<TrendingUp size={20} />}
                title="Oportunidades de mejora"
                description="EOS puede ayudarte a identificar acciones para optimizar resultados y productividad."
                tone="green"
              />

              <InsightRow
                icon={<Target size={20} />}
                title="Próximo objetivo"
                description={
                  activeObjectives > 0
                    ? `${activeObjectives} objetivo${
                        activeObjectives === 1 ? "" : "s"
                      } activo${
                        activeObjectives === 1 ? "" : "s"
                      } requiere${
                        activeObjectives === 1 ? "" : "n"
                      } seguimiento.`
                    : "Definí un objetivo concreto para que EOS pueda registrar y medir el progreso."
                }
                tone="blue"
              />

              <InsightRow
                icon={<FileSpreadsheet size={20} />}
                title="Documentos disponibles"
                description={
                  generatedDocuments > 0
                    ? `Tenés ${generatedDocuments} archivo${
                        generatedDocuments === 1 ? "" : "s"
                      } generado${
                        generatedDocuments === 1 ? "" : "s"
                      } en EOS.`
                    : "Podés pedirle a EOS que prepare Excel, informes, presupuestos o documentos."
                }
                tone="blue"
              />

              <InsightRow
                icon={<Clock3 size={20} />}
                title="Actividad reciente"
                description={
                  ultimoChat
                    ? `Última conversación: ${ultimoChat}.`
                    : "Todavía no existe actividad reciente registrada."
                }
                tone="amber"
              />
            </div>
          </article>

          <article className="dashboard-progress-card">
            <div className="dashboard-progress-header">
              <div>
                <span className="dashboard-section-label">
                  PRODUCTIVIDAD
                </span>

                <h2>Progreso semanal</h2>
              </div>

              <span className="dashboard-progress-icon">
                <BarChart3 size={23} />
              </span>
            </div>

            <p className="dashboard-progress-description">
              Estimación construida a partir del score, las conversaciones
              y la actividad registrada en EOS.
            </p>

            <div className="dashboard-progress-summary">
              <span>Avance acumulado</span>
              <strong>{progresoSemanal}%</strong>
            </div>

            <div className="dashboard-progress-track">
              <div
                className="dashboard-progress-value"
                style={{
                  width: `${progresoSemanal}%`,
                }}
              />
            </div>

            <div className="dashboard-progress-stats">
              <ProgressStat
                label="Actividad"
                value={
                  mensajesVisibles > 0
                    ? "Activa"
                    : "Inicial"
                }
              />

              <ProgressStat
                label="Contexto"
                value={
                  conversacionesVisibles > 2
                    ? "Sólido"
                    : "En desarrollo"
                }
              />

              <ProgressStat
                label="Estado"
                value={obtenerEstado(scoreVisible)}
              />
            </div>
          </article>
        </section>

        <section className="dashboard-lower-grid">
          <article className="dashboard-recommendation">
            <div className="dashboard-recommendation-top">
              <span className="dashboard-recommendation-icon">
                <Sparkles size={24} />
              </span>

              <div>
                <span className="dashboard-light-label">
                  RECOMENDACIÓN EOS
                </span>

                <h2>Próxima acción sugerida</h2>
              </div>
            </div>

            <p>
              {obtenerRecomendacion(
                scoreVisible,
                conversacionesVisibles,
                mensajesVisibles,
              )}
            </p>

            <button
              type="button"
              onClick={onOpenChat}
              className="dashboard-recommendation-button"
            >
              Ejecutar con EOS
              <ArrowRight size={17} />
            </button>
          </article>

          <article className="dashboard-activity-card">
            <div className="dashboard-card-header">
              <div>
                <span className="dashboard-section-label">
                  ACTIVIDAD
                </span>

                <h2>Resumen reciente</h2>
              </div>

              <span className="dashboard-card-icon">
                <Clock3 size={22} />
              </span>
            </div>

            <div className="dashboard-activity-list">
              <ActivityItem
                title="Sistema conectado"
                description="EOS está disponible para trabajar."
              />

              <ActivityItem
                title="Memoria contextual"
                description="El contexto se actualiza con cada conversación."
              />

              <ActivityItem
                title="Último espacio utilizado"
                description={
                  ultimoChat || "No hay conversaciones recientes."
                }
              />
            </div>
          </article>
        </section>

        <footer className="dashboard-footer">
          <span className="dashboard-footer-dot" />

          EOS actualizará este centro de control a medida que registres más
          actividad.
        </footer>
      </div>

      <style jsx>{`
        .intelligence-card { margin: 22px 0; padding: 27px; border: 1px solid #dbeafe; border-radius: 28px; background: rgba(255,255,255,.92); box-shadow: 0 20px 60px rgba(37,99,235,.07); }
        .intelligence-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
        .intelligence-title-row { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-top:8px; }
        .intelligence-heading h2 { margin:0; color:#071226; font-size:26px; letter-spacing:-.035em; }
        .intelligence-heading p { margin:8px 0 0; color:#64748b; font-size:11px; }
        .intelligence-heading button { display:inline-flex; align-items:center; gap:7px; min-height:38px; padding:0 14px; border:0; border-radius:999px; background:#2563eb; color:white; font:800 9px inherit; cursor:pointer; }
        .intelligence-delta { display:inline-flex; align-items:center; min-height:25px; padding:0 9px; border-radius:999px; font-size:9px; font-weight:900; letter-spacing:.02em; }
        .intelligence-delta-up { background:#ecfdf5; color:#047857; }
        .intelligence-delta-down { background:#fff1f2; color:#be123c; }
        .intelligence-delta-stable, .intelligence-delta-new { background:#eff6ff; color:#1d4ed8; }
        .dimension-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; margin-top:22px; }
        .dimension-item { padding:14px; border-radius:16px; background:#f8fafc; }
        .dimension-item > div:first-child { display:flex; justify-content:space-between; gap:8px; color:#475569; font-size:9px; font-weight:800; }
        .dimension-item strong { color:#071226; font-size:15px; }
        .dimension-track { height:6px; margin-top:10px; overflow:hidden; border-radius:999px; background:#e2e8f0; }
        .dimension-track span { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#2563eb,#60a5fa); }
        .intelligence-detail-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr); gap:12px; margin-top:14px; }
        .intelligence-trend-panel, .intelligence-history-panel { min-width:0; padding:16px; border:1px solid #e2e8f0; border-radius:18px; background:#fbfdff; }
        .intelligence-panel-heading { display:flex; justify-content:space-between; align-items:center; gap:12px; color:#64748b; font-size:8px; font-weight:900; letter-spacing:.11em; }
        .intelligence-panel-heading strong { color:#0f172a; font-size:9px; letter-spacing:0; }
        .intelligence-trend-panel > p { margin:10px 0 0; color:#334155; font-size:10px; line-height:1.55; }
        .intelligence-drivers { display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
        .intelligence-driver { display:inline-flex; padding:6px 8px; border-radius:999px; font-size:8px; font-weight:850; }
        .intelligence-driver-positivo { background:#ecfdf5; color:#047857; }
        .intelligence-driver-negativo { background:#fff1f2; color:#be123c; }
        .intelligence-neutral { display:block; margin-top:12px; color:#94a3b8; font-size:9px; line-height:1.45; }
        .intelligence-history-bars { display:flex; align-items:flex-end; gap:4px; height:92px; margin-top:12px; }
        .intelligence-history-column { display:flex; flex:1 1 0; min-width:0; height:100%; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; }
        .intelligence-history-value { color:#64748b; font-size:7px; font-weight:800; }
        .intelligence-history-track { position:relative; width:100%; max-width:14px; height:70px; overflow:hidden; border-radius:999px; background:#e2e8f0; }
        .intelligence-history-track > span { position:absolute; right:0; bottom:0; left:0; display:block; border-radius:inherit; background:linear-gradient(180deg,#60a5fa,#2563eb); }
        .intelligence-history-range { display:flex; justify-content:space-between; gap:10px; margin-top:7px; color:#94a3b8; font-size:7px; font-weight:700; }
        .intelligence-footer-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:14px; }
        .intelligence-next { flex:1; margin:0; padding:11px 13px; border-radius:13px; background:#eff6ff; color:#1d4ed8; font-size:10px; }
        .intelligence-calculated { flex:0 0 auto; color:#94a3b8; font-size:8px; font-weight:700; }
        @media(max-width:980px){ .dimension-grid{grid-template-columns:repeat(2,minmax(0,1fr));} .intelligence-detail-grid{grid-template-columns:1fr;} }
        @media(max-width:760px){ .intelligence-heading{flex-direction:column;} .intelligence-heading button{width:100%;justify-content:center;} .dimension-grid{grid-template-columns:1fr;} .intelligence-footer-row{align-items:stretch;flex-direction:column;} .intelligence-calculated{text-align:right;} }
        .dashboard-page {
          position: relative;
          flex: 1;
          min-height: 0;
          overflow-x: hidden;
          overflow-y: auto;
          padding: 38px 34px 72px;
          background:
            linear-gradient(
              180deg,
              #ffffff 0%,
              #f7faff 50%,
              #eef5ff 100%
            );
          color: #071226;
          font-family: Inter, Arial, Helvetica, sans-serif;
          scrollbar-width: thin;
          scrollbar-color: rgba(37, 99, 235, 0.28) transparent;
        }

        .dashboard-page::-webkit-scrollbar {
          width: 8px;
        }

        .dashboard-page::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.24);
        }

        .dashboard-grid-pattern {
          position: fixed;
          inset: 86px 0 0 280px;
          pointer-events: none;
          opacity: 0.32;
          background-image:
            linear-gradient(
              rgba(15, 23, 42, 0.035) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              rgba(15, 23, 42, 0.035) 1px,
              transparent 1px
            );
          background-size: 44px 44px;
          mask-image: linear-gradient(
            to bottom,
            black,
            transparent 91%
          );
        }

        .dashboard-glow {
          position: fixed;
          border-radius: 999px;
          filter: blur(120px);
          pointer-events: none;
        }

        .dashboard-glow-one {
          top: 110px;
          right: 2%;
          width: 540px;
          height: 540px;
          background: rgba(37, 99, 235, 0.11);
        }

        .dashboard-glow-two {
          bottom: -210px;
          left: 26%;
          width: 620px;
          height: 620px;
          background: rgba(96, 165, 250, 0.12);
        }

        .dashboard-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1180px;
          margin: 0 auto;
        }

        .dashboard-hero {
          position: relative;
          display: grid;
          grid-template-columns:
            minmax(0, 1fr)
            minmax(190px, 260px);
          align-items: center;
          gap: 38px;
          padding: 40px;
          overflow: hidden;
          border: 1px solid rgba(37, 99, 235, 0.15);
          border-radius: 34px;
          background:
            linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.98),
              rgba(239, 246, 255, 0.92)
            );
          box-shadow:
            0 28px 80px rgba(15, 23, 42, 0.09),
            inset 0 1px 0 rgba(255, 255, 255, 0.96);
        }

        .dashboard-hero::after {
          content: "";
          position: absolute;
          top: -190px;
          right: -130px;
          width: 470px;
          height: 470px;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.13);
          filter: blur(70px);
          pointer-events: none;
        }

        .dashboard-hero-copy,
        .dashboard-hero > :global(*) {
          position: relative;
          z-index: 1;
        }

        .dashboard-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #2563eb;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.17em;
        }

        .dashboard-eyebrow-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #2563eb;
          box-shadow: 0 0 12px rgba(37, 99, 235, 0.55);
        }

        .dashboard-hero h1 {
          margin: 18px 0 0;
          color: #071226;
          font-size: clamp(40px, 5vw, 66px);
          font-weight: 950;
          line-height: 0.98;
          letter-spacing: -0.055em;
        }

        .dashboard-hero-copy > p {
          max-width: 720px;
          margin: 22px 0 0;
          color: #64748b;
          font-size: 15px;
          line-height: 1.75;
        }

        .dashboard-hero-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 27px;
        }

        .dashboard-primary-button {
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          padding: 0 20px;
          border: 0;
          border-radius: 999px;
          background: #2563eb;
          color: white;
          font-family: inherit;
          font-size: 12px;
          font-weight: 850;
          cursor: pointer;
          box-shadow: 0 14px 30px rgba(37, 99, 235, 0.23);
          transition:
            transform 180ms ease,
            background 180ms ease;
        }

        .dashboard-primary-button:hover {
          transform: translateY(-2px);
          background: #1d4ed8;
        }

        .dashboard-plan-pill,
        .dashboard-system-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 10px 13px;
          border: 1px solid #dbeafe;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.88);
          color: #2563eb;
          font-size: 10px;
          font-weight: 850;
        }

        .dashboard-section {
          margin-top: 36px;
        }

        .dashboard-section-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 18px;
        }

        .dashboard-section-label,
        .dashboard-light-label {
          color: #2563eb;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        .dashboard-light-label {
          color: #bfdbfe;
        }

        .dashboard-section-header h2,
        .dashboard-card-header h2,
        .dashboard-progress-header h2 {
          margin: 9px 0 0;
          color: #071226;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        .dashboard-system-status {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #15803d;
        }

        .dashboard-system-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.6);
        }

        .dashboard-metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .dashboard-content-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.35fr)
            minmax(300px, 0.65fr);
          gap: 19px;
          margin-top: 22px;
        }

        .dashboard-insights-card,
        .dashboard-progress-card,
        .dashboard-activity-card {
          padding: 27px;
          border: 1px solid rgba(148, 163, 184, 0.17);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.91);
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(20px);
        }

        .dashboard-card-header,
        .dashboard-progress-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .dashboard-card-icon,
        .dashboard-progress-icon {
          width: 46px;
          height: 46px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 15px;
          background: #eff6ff;
          color: #2563eb;
        }

        .dashboard-insights-list {
          display: grid;
          gap: 12px;
          margin-top: 24px;
        }

        .dashboard-progress-description {
          margin: 15px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.65;
        }

        .dashboard-progress-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 34px;
          color: #64748b;
          font-size: 12px;
        }

        .dashboard-progress-summary strong {
          color: #2563eb;
          font-size: 21px;
          font-weight: 900;
        }

        .dashboard-progress-track {
          height: 10px;
          overflow: hidden;
          margin-top: 11px;
          border-radius: 999px;
          background: #e9eff8;
        }

        .dashboard-progress-value {
          height: 100%;
          border-radius: inherit;
          background:
            linear-gradient(
              90deg,
              #2563eb,
              #60a5fa
            );
          box-shadow: 0 0 18px rgba(37, 99, 235, 0.28);
          transition: width 700ms ease;
        }

        .dashboard-progress-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 9px;
          margin-top: 28px;
        }

        .dashboard-lower-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.15fr)
            minmax(330px, 0.85fr);
          gap: 19px;
          margin-top: 22px;
        }

        .dashboard-recommendation {
          position: relative;
          overflow: hidden;
          padding: 31px;
          border-radius: 30px;
          background: #071226;
          color: white;
          box-shadow: 0 25px 75px rgba(7, 18, 38, 0.2);
        }

        .dashboard-recommendation::before {
          content: "";
          position: absolute;
          top: -150px;
          right: -100px;
          width: 380px;
          height: 380px;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.45);
          filter: blur(90px);
          pointer-events: none;
        }

        .dashboard-recommendation-top {
          position: relative;
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .dashboard-recommendation-icon {
          width: 50px;
          height: 50px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.08);
          color: #93c5fd;
        }

        .dashboard-recommendation h2 {
          margin: 9px 0 0;
          font-size: 27px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        .dashboard-recommendation > p {
          position: relative;
          margin: 25px 0 0;
          color: #dbeafe;
          font-size: 17px;
          font-weight: 650;
          line-height: 1.65;
        }

        .dashboard-recommendation-button {
          position: relative;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 25px;
          padding: 0 17px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          font-family: inherit;
          font-size: 11px;
          font-weight: 850;
          cursor: pointer;
          transition:
            transform 180ms ease,
            background 180ms ease;
        }

        .dashboard-recommendation-button:hover {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.17);
        }

        .dashboard-activity-list {
          display: grid;
          gap: 11px;
          margin-top: 24px;
        }

        .dashboard-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 24px;
          color: #94a3b8;
          font-size: 10px;
          font-weight: 700;
          text-align: center;
        }

        .dashboard-footer-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.55);
        }

        @media (max-width: 1040px) {
          .dashboard-metrics-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .dashboard-content-grid,
          .dashboard-lower-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .dashboard-page {
            padding: 28px 18px 55px;
          }

          .dashboard-grid-pattern {
            left: 0;
          }

          .dashboard-hero {
            grid-template-columns: 1fr;
            padding: 27px;
          }

          .dashboard-hero h1 {
            font-size: clamp(38px, 11vw, 52px);
          }

          .dashboard-section-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .dashboard-metrics-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function ScoreRing({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const grados = value * 3.6;

  return (
    <div className="score-wrapper">
      <div
        className="score-ring"
        style={{
          background: `conic-gradient(
            #2563eb 0deg,
            #60a5fa ${grados}deg,
            #e5edf8 ${grados}deg,
            #e5edf8 360deg
          )`,
        }}
      >
        <div className="score-ring-inner">
          <strong>{value}%</strong>
          <span>{label}</span>
        </div>
      </div>

      <style jsx>{`
        .score-wrapper {
          display: grid;
          place-items: center;
        }

        .score-ring {
          width: 174px;
          height: 174px;
          display: grid;
          place-items: center;
          padding: 13px;
          border-radius: 50%;
          box-shadow:
            0 22px 60px rgba(37, 99, 235, 0.18),
            0 0 35px rgba(37, 99, 235, 0.1);
        }

        .score-ring-inner {
          width: 100%;
          height: 100%;
          display: grid;
          place-content: center;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.96);
          text-align: center;
          box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.14);
        }

        .score-ring-inner strong {
          color: #071226;
          font-size: 35px;
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .score-ring-inner span {
          margin-top: 4px;
          color: #64748b;
          font-size: 9px;
          font-weight: 850;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  description,
}: MetricProps) {
  return (
    <article className="metric-card">
      <span className="metric-icon">{icon}</span>

      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{description}</small>
      </div>

      <style jsx>{`
        .metric-card {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 20px;
          border: 1px solid rgba(148, 163, 184, 0.17);
          border-radius: 23px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow:
            0 17px 46px rgba(15, 23, 42, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .metric-card:hover {
          transform: translateY(-4px);
          border-color: rgba(37, 99, 235, 0.25);
          box-shadow: 0 23px 58px rgba(37, 99, 235, 0.09);
        }

        .metric-icon {
          width: 49px;
          height: 49px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 16px;
          background: #eff6ff;
          color: #2563eb;
        }

        .metric-copy {
          min-width: 0;
          display: grid;
          gap: 4px;
        }

        .metric-copy > span {
          color: #64748b;
          font-size: 10px;
          font-weight: 750;
        }

        .metric-copy strong {
          color: #071226;
          font-size: 27px;
          font-weight: 950;
          line-height: 1;
        }

        .metric-copy small {
          color: #94a3b8;
          font-size: 8px;
          line-height: 1.4;
        }
      `}</style>
    </article>
  );
}

function InsightRow({
  icon,
  title,
  description,
  tone,
}: InsightProps) {
  return (
    <div className={`insight insight-${tone}`}>
      <span className="insight-icon">{icon}</span>

      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>

      <style jsx>{`
        .insight {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr);
          gap: 13px;
          align-items: flex-start;
          padding: 14px;
          border: 1px solid #edf2f7;
          border-radius: 17px;
          background: #f8fbff;
        }

        .insight-icon {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border-radius: 13px;
          background: #eff6ff;
          color: #2563eb;
        }

        .insight-green .insight-icon {
          background: #ecfdf5;
          color: #16a34a;
        }

        .insight-amber .insight-icon {
          background: #fffbeb;
          color: #d97706;
        }

        .insight strong {
          color: #071226;
          font-size: 12px;
          font-weight: 850;
        }

        .insight p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 10px;
          line-height: 1.55;
        }
      `}</style>
    </div>
  );
}

function ProgressStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="progress-stat">
      <span>{label}</span>
      <strong>{value}</strong>

      <style jsx>{`
        .progress-stat {
          min-width: 0;
          padding: 12px;
          border: 1px solid #edf2f7;
          border-radius: 15px;
          background: #f8fbff;
        }

        .progress-stat span {
          display: block;
          color: #94a3b8;
          font-size: 8px;
          font-weight: 750;
        }

        .progress-stat strong {
          display: block;
          overflow: hidden;
          margin-top: 5px;
          color: #071226;
          font-size: 10px;
          font-weight: 850;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

function ActivityItem({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="activity-item">
      <span className="activity-check">
        <CheckCircle2 size={17} />
      </span>

      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>

      <style jsx>{`
        .activity-item {
          display: grid;
          grid-template-columns: 35px minmax(0, 1fr);
          gap: 11px;
          align-items: flex-start;
          padding: 12px;
          border: 1px solid #edf2f7;
          border-radius: 16px;
          background: #f8fbff;
        }

        .activity-check {
          width: 33px;
          height: 33px;
          display: grid;
          place-items: center;
          border-radius: 11px;
          background: #ecfdf5;
          color: #16a34a;
        }

        .activity-item strong {
          color: #071226;
          font-size: 11px;
          font-weight: 850;
        }

        .activity-item p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 9px;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}

function obtenerPrimerNombre(nombre: string) {
  const limpio = nombre.trim();

  if (!limpio) return "Usuario";

  return limpio.split(/\s+/)[0];
}

function obtenerSaludo() {
  const hora = new Date().getHours();

  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";

  return "Buenas noches";
}

function normalizarPorcentaje(value: number) {
  const numero = Number(value);

  if (!Number.isFinite(numero)) return 0;

  return Math.min(100, Math.max(0, Math.round(numero)));
}

function calcularProgreso(
  score: number,
  conversaciones: number,
  mensajes: number,
) {
  if (score > 0) {
    return normalizarPorcentaje(
      score * 0.7 +
        Math.min(conversaciones * 3, 15) +
        Math.min(mensajes, 15),
    );
  }

  return normalizarPorcentaje(
    Math.min(conversaciones * 8, 45) +
      Math.min(mensajes * 2, 35),
  );
}

function obtenerEstado(score: number) {
  if (score >= 80) return "Excelente";
  if (score >= 60) return "Estable";
  if (score >= 40) return "En progreso";
  if (score > 0) return "Inicial";

  return "Sin datos";
}

function obtenerRecomendacion(
  score: number,
  conversaciones: number,
  mensajes: number,
) {
  if (conversaciones === 0) {
    return "Iniciá una conversación y explicale a EOS qué querés mejorar. Con ese contexto podrá generar un plan más preciso.";
  }

  if (mensajes === 0) {
    return "Continuá la conversación activa para que EOS pueda comprender tu situación y detectar acciones concretas.";
  }

  if (score < 40) {
    return "Definí una meta principal y pedile a EOS que la convierta en tareas pequeñas, claras y medibles.";
  }

  if (score < 70) {
    return "Elegí la acción pendiente de mayor impacto y pedile a EOS un plan de ejecución para completarla.";
  }

  return "Revisá los resultados actuales y pedile a EOS que prepare la siguiente etapa de crecimiento.";
}

function capitalizar(value: string) {
  const limpio = value.trim();

  if (!limpio) return "Free";

  return (
    limpio.charAt(0).toUpperCase() +
    limpio.slice(1).toLowerCase()
  );
}
