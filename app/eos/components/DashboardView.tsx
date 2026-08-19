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
  const scoreVisible = normalizarPorcentaje(
    score ?? eosScore ?? 0,
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
          font-family: var(--font-inter), Inter, Arial, Helvetica, sans-serif;
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
          color: #1656bd;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.17em;
        }

        .dashboard-eyebrow-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #1656bd;
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
          background: #1656bd;
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
          background: #113f8c;
        }

        .dashboard-plan-pill,
        .dashboard-system-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 10px 13px;
          border: 1px solid #e9f0fb;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.88);
          color: #1656bd;
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
          color: #1656bd;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        .dashboard-light-label {
          color: #a9c6ee;
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
          background: #eef3fb;
          color: #1656bd;
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
          color: #1656bd;
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
              #1656bd,
              #2f72d6
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
          color: #6fa3e8;
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
          color: #e9f0fb;
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
            #1656bd 0deg,
            #2f72d6 ${grados}deg,
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
          background: #eef3fb;
          color: #1656bd;
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
          background: #eef3fb;
          color: #1656bd;
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