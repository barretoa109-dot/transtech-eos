"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  CircleGauge,
  Lightbulb,
  ListChecks,
  MessageCircleMore,
  RefreshCw,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import type {
  Briefing,
  BriefingApiResponse,
  BriefingItem,
  ExecutiveAttentionItem,
} from "../types/briefing";

type BriefingViewProps = {
  briefing: Briefing;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  isStale?: boolean;
  historyCount?: number;
  attention?: BriefingApiResponse["attention"];
  onRefresh?: () => void;
  onOpenChat?: (prompt: string) => void;
};

export default function BriefingView({
  briefing,
  loading = false,
  refreshing = false,
  error,
  isStale = false,
  historyCount = 0,
  attention,
  onRefresh,
  onOpenChat,
}: BriefingViewProps) {
  const score = normalizarScore(briefing.score);
  const estado = obtenerEstado(score);
  const briefingDate = formatBriefingDate(briefing.briefing_date);
  const generatedTime = formatGeneratedTime(
    briefing.generated_at || briefing.created_at,
  );
  const logros = normalizeItems(briefing.logros);
  const riesgos = normalizeItems(briefing.riesgos);
  const pasos = normalizeItems(briefing.proximos_pasos).slice(0, 4);

  const prioridades = [
    {
      numero: "01",
      titulo: "Prioridad principal",
      texto:
        briefing.prioridad_1 ||
        "Definir el próximo objetivo importante.",
      nivel: "Alta",
      icono: <Target size={21} />,
    },
    {
      numero: "02",
      titulo: "Segunda prioridad",
      texto:
        briefing.prioridad_2 ||
        "Organizar la información disponible.",
      nivel: "Media",
      icono: <ListChecks size={21} />,
    },
    {
      numero: "03",
      titulo: "Tercera prioridad",
      texto:
        briefing.prioridad_3 ||
        "Determinar la siguiente acción.",
      nivel: "Normal",
      icono: <CheckCircle2 size={21} />,
    },
  ];

  return (
    <main className="briefing-page">
      <div className="briefing-grid-pattern" />
      <div className="briefing-glow briefing-glow-one" />
      <div className="briefing-glow briefing-glow-two" />

      <div className="briefing-container">
        <header className="briefing-hero">
          <div className="briefing-hero-copy">
            <div className="briefing-meta-row">
              <div className="briefing-eyebrow">
                <span className="briefing-live-dot" />
                BRIEFING DIARIO
              </div>

              <span className={`freshness-badge ${isStale ? "is-stale" : ""}`}>
                <CalendarDays size={13} />
                {briefingDate || (loading ? "Preparando" : "Sin briefing de hoy")}
              </span>
            </div>

            <h1>
              {briefing.saludo || "Tu resumen ejecutivo"}
            </h1>

            <p>
              {briefing.titulo_dia ||
                "EOS transformó tu actividad, objetivos y decisiones en un plan claro para hoy."}
            </p>

            <div className="briefing-actions">
              {onRefresh && (
                <button
                  type="button"
                  className="refresh-button"
                  onClick={onRefresh}
                  disabled={refreshing}
                >
                  <RefreshCw size={15} className={refreshing ? "is-spinning" : ""} />
                  {refreshing ? "Actualizando" : "Actualizar briefing"}
                </button>
              )}

              <span className="generated-time">
                {generatedTime
                  ? `Generado ${generatedTime}`
                  : "Se genera diariamente a las 20:00"}
              </span>
            </div>

            {error && <p className="briefing-error">{error}</p>}
          </div>

          <ScoreCard
            score={score}
            estado={estado}
          />
        </header>

        <section className="summary-card">
          <div className="summary-icon">
            <BrainCircuit size={27} />
          </div>

          <div className="summary-copy">
            <span className="section-label">
              RESUMEN ACTUAL
            </span>

            <h2>Panorama general</h2>

            <p>
              {briefing.resumen ||
                "EOS está listo para analizar tu situación cuando comiences a conversar."}
            </p>

            {briefing.enfoque_dia && (
              <div className="daily-focus">
                <Target size={16} />
                <span><strong>Foco del día:</strong> {briefing.enfoque_dia}</span>
              </div>
            )}
          </div>
        </section>

        {attention && attention.items.length > 0 && (
          <AttentionBoard
            attention={attention}
            onOpenChat={onOpenChat}
            onUpdated={onRefresh}
          />
        )}

        <section className="briefing-section">
          <div className="section-header">
            <div>
              <span className="section-label">
                FOCO INMEDIATO
              </span>

              <h2>Prioridades detectadas</h2>
            </div>

            <span className="section-count">
              3 prioridades
            </span>
          </div>

          <div className="priority-grid">
            {prioridades.map((prioridad, index) => (
              <PriorityCard
                key={prioridad.numero}
                {...prioridad}
                destacada={index === 0}
              />
            ))}
          </div>
        </section>

        {(logros.length > 0 || riesgos.length > 0) && (
          <section className="signals-grid" aria-label="Señales del briefing">
            <SignalCard
              title="Avances detectados"
              label="LO QUE ESTÁ FUNCIONANDO"
              items={logros}
              icon={<Award size={22} />}
              tone="success"
              empty="Todavía no hay avances confirmados para destacar."
            />

            <SignalCard
              title="Riesgos que requieren atención"
              label="VIGILANCIA ACTIVA"
              items={riesgos}
              icon={<AlertTriangle size={22} />}
              tone="warning"
              empty="EOS no detectó riesgos críticos en este momento."
            />
          </section>
        )}

        <div className="briefing-bottom-grid">
          <section className="recommendation-card">
            <div className="recommendation-header">
              <div className="recommendation-icon">
                <Lightbulb size={24} />
              </div>

              <div>
                <span className="section-label section-label-light">
                  RECOMENDACIÓN PRINCIPAL
                </span>

                <h2>Próxima decisión sugerida</h2>
              </div>
            </div>

            <p className="recommendation-text">
              {briefing.recomendacion_principal ||
                "Contale a EOS qué querés lograr para recibir una recomendación más precisa."}
            </p>

            <div className="recommendation-footer">
              <span className="recommendation-dot" />
              Recomendación generada según tu contexto actual
            </div>

            {onOpenChat && (
              <button
                type="button"
                className="recommendation-action"
                onClick={() =>
                  onOpenChat(
                    `Quiero trabajar sobre esta recomendación de mi briefing: ${briefing.recomendacion_principal || "ayudame a definir la mejor acción para hoy"}`,
                  )
                }
              >
                <MessageCircleMore size={16} />
                Trabajar esto con EOS
              </button>
            )}
          </section>

          <section className="steps-card">
            <div className="steps-header">
              <div>
                <span className="section-label">
                  PLAN SUGERIDO
                </span>

                <h2>Próximos pasos</h2>
              </div>

              <span className="steps-header-icon">
                <Sparkles size={21} />
              </span>
            </div>

            <div className="steps-list">
              {(pasos.length
                ? pasos
                : [
                    { titulo: "Compartí el contexto actual" },
                    { titulo: "Definí una meta concreta" },
                    { titulo: "Ejecutá el próximo paso" },
                  ]
              ).map((paso, index) => (
                <Step
                  key={`${paso.titulo}-${index}`}
                  numero={String(index + 1)}
                  titulo={paso.titulo}
                  descripcion={
                    paso.descripcion ||
                    "Pedile a EOS que te ayude a convertir este paso en una acción concreta."
                  }
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="briefing-footer">
          <span className="briefing-footer-dot" />

          {historyCount > 1
            ? `${historyCount} briefings recientes disponibles. EOS actualiza el análisis cada día.`
            : "EOS actualizará este briefing cada día con tus objetivos, tareas, avances y decisiones."}
        </footer>
      </div>

      <style jsx>{`
        .briefing-page {
          position: relative;
          flex: 1;
          min-height: 0;
          overflow-x: hidden;
          overflow-y: auto;
          padding: 42px 34px 70px;
          background:
            linear-gradient(
              180deg,
              #ffffff 0%,
              #f7faff 52%,
              #eef5ff 100%
            );
          color: #071226;
          font-family: Inter, Arial, Helvetica, sans-serif;
          scrollbar-width: thin;
          scrollbar-color: rgba(37, 99, 235, 0.28) transparent;
        }

        .briefing-page::-webkit-scrollbar {
          width: 8px;
        }

        .briefing-page::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.24);
        }

        .briefing-grid-pattern {
          position: fixed;
          inset: 86px 0 0 280px;
          pointer-events: none;
          opacity: 0.34;
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
            transparent 90%
          );
        }

        .briefing-glow {
          position: fixed;
          border-radius: 999px;
          filter: blur(115px);
          pointer-events: none;
        }

        .briefing-glow-one {
          top: 110px;
          right: 3%;
          width: 500px;
          height: 500px;
          background: rgba(37, 99, 235, 0.11);
        }

        .briefing-glow-two {
          bottom: -180px;
          left: 28%;
          width: 540px;
          height: 540px;
          background: rgba(96, 165, 250, 0.12);
        }

        .briefing-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1160px;
          margin: 0 auto;
        }

        .briefing-hero {
          display: grid;
          grid-template-columns:
            minmax(0, 1fr)
            minmax(230px, 300px);
          align-items: center;
          gap: 34px;
          margin-bottom: 28px;
        }

        .briefing-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #2563eb;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.17em;
        }

        .briefing-meta-row,
        .briefing-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }

        .freshness-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          border: 1px solid #bbf7d0;
          border-radius: 999px;
          background: #f0fdf4;
          color: #15803d;
          font-size: 9px;
          font-weight: 850;
        }

        .freshness-badge.is-stale {
          border-color: #fed7aa;
          background: #fff7ed;
          color: #c2410c;
        }

        .briefing-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #2563eb;
          box-shadow: 0 0 12px rgba(37, 99, 235, 0.55);
        }

        .briefing-hero h1 {
          max-width: 760px;
          margin: 18px 0 0;
          color: #071226;
          font-size: clamp(42px, 5vw, 68px);
          font-weight: 950;
          line-height: 0.98;
          letter-spacing: -0.055em;
        }

        .briefing-hero-copy > p {
          max-width: 760px;
          margin: 22px 0 0;
          color: #64748b;
          font-size: 16px;
          line-height: 1.75;
        }

        .briefing-actions {
          margin-top: 20px;
        }

        .refresh-button,
        .recommendation-action {
          border: 0;
          font-family: inherit;
          cursor: pointer;
        }

        .refresh-button {
          min-height: 39px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 14px;
          border: 1px solid #dbeafe;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.9);
          color: #2563eb;
          font-size: 10px;
          font-weight: 850;
          box-shadow: 0 9px 24px rgba(37, 99, 235, 0.08);
        }

        .refresh-button:disabled {
          opacity: 0.62;
          cursor: wait;
        }

        .generated-time {
          color: #94a3b8;
          font-size: 9px;
          font-weight: 750;
        }

        .briefing-error {
          width: fit-content;
          margin-top: 12px !important;
          padding: 8px 11px;
          border-radius: 11px;
          background: #fff7ed;
          color: #c2410c !important;
          font-size: 10px !important;
        }

        .is-spinning {
          animation: briefing-spin 850ms linear infinite;
        }

        @keyframes briefing-spin {
          to { transform: rotate(360deg); }
        }

        .summary-card {
          position: relative;
          display: flex;
          align-items: flex-start;
          gap: 18px;
          padding: 28px;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.17);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow:
            0 20px 60px rgba(15, 23, 42, 0.07),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
        }

        .summary-card::after {
          content: "";
          position: absolute;
          top: -130px;
          right: -90px;
          width: 310px;
          height: 310px;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.09);
          filter: blur(60px);
          pointer-events: none;
        }

        .summary-icon {
          position: relative;
          z-index: 1;
          width: 58px;
          height: 58px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: #2563eb;
          color: white;
          box-shadow: 0 15px 30px rgba(37, 99, 235, 0.2);
        }

        .summary-copy {
          position: relative;
          z-index: 1;
          min-width: 0;
        }

        .section-label {
          color: #2563eb;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        .section-label-light {
          color: #bfdbfe;
        }

        .summary-copy h2,
        .section-header h2,
        .steps-header h2 {
          margin: 9px 0 0;
          color: #071226;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        .summary-copy p {
          max-width: 900px;
          margin: 12px 0 0;
          color: #64748b;
          font-size: 15px;
          line-height: 1.75;
        }

        .daily-focus {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          width: fit-content;
          margin-top: 16px;
          padding: 10px 12px;
          border: 1px solid #dbeafe;
          border-radius: 13px;
          background: #eff6ff;
          color: #1d4ed8;
          font-size: 11px;
          line-height: 1.5;
        }

        .briefing-section {
          margin-top: 34px;
        }

        .section-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 18px;
        }

        .section-count {
          padding: 8px 12px;
          border: 1px solid #dbeafe;
          border-radius: 999px;
          background: #ffffff;
          color: #2563eb;
          font-size: 10px;
          font-weight: 850;
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.06);
        }

        .priority-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .briefing-bottom-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.2fr)
            minmax(320px, 0.8fr);
          gap: 18px;
          margin-top: 22px;
        }

        .signals-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          margin-top: 22px;
        }

        .recommendation-card {
          position: relative;
          overflow: hidden;
          padding: 30px;
          border-radius: 30px;
          background: #071226;
          color: white;
          box-shadow: 0 24px 70px rgba(7, 18, 38, 0.18);
        }

        .recommendation-card::before {
          content: "";
          position: absolute;
          top: -120px;
          right: -90px;
          width: 330px;
          height: 330px;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.42);
          filter: blur(85px);
          pointer-events: none;
        }

        .recommendation-header {
          position: relative;
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .recommendation-icon {
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

        .recommendation-header h2 {
          margin: 9px 0 0;
          font-size: 27px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        .recommendation-text {
          position: relative;
          margin: 26px 0 0;
          color: #dbeafe;
          font-size: 18px;
          font-weight: 650;
          line-height: 1.65;
        }

        .recommendation-footer {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 26px;
          color: #94a3b8;
          font-size: 10px;
          font-weight: 700;
        }

        .recommendation-action {
          position: relative;
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 20px;
          padding: 0 16px;
          border-radius: 999px;
          background: #2563eb;
          color: white;
          font-size: 10px;
          font-weight: 850;
          box-shadow: 0 13px 30px rgba(37, 99, 235, 0.25);
          transition: transform 160ms ease, background 160ms ease;
        }

        .recommendation-action:hover {
          transform: translateY(-2px);
          background: #1d4ed8;
        }

        .recommendation-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #60a5fa;
          box-shadow: 0 0 12px rgba(96, 165, 250, 0.65);
        }

        .steps-card {
          padding: 27px;
          border: 1px solid rgba(148, 163, 184, 0.17);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.91);
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(20px);
        }

        .steps-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .steps-header-icon {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #eff6ff;
          color: #2563eb;
        }

        .steps-list {
          display: grid;
          gap: 14px;
          margin-top: 24px;
        }

        .briefing-footer {
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

        .briefing-footer-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.55);
        }

        @media (max-width: 980px) {
          .briefing-hero {
            grid-template-columns: 1fr;
          }

          .priority-grid {
            grid-template-columns: 1fr;
          }

          .briefing-bottom-grid {
            grid-template-columns: 1fr;
          }

          .signals-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .briefing-page {
            padding: 28px 18px 55px;
          }

          .briefing-grid-pattern {
            left: 0;
          }

          .briefing-hero h1 {
            font-size: clamp(38px, 11vw, 52px);
          }

          .section-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .summary-card {
            flex-direction: column;
          }

          .briefing-actions,
          .refresh-button,
          .recommendation-action {
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}

function AttentionBoard({
  attention,
  onOpenChat,
  onUpdated,
}: {
  attention: NonNullable<BriefingApiResponse["attention"]>;
  onOpenChat?: (prompt: string) => void;
  onUpdated?: () => void;
}) {
  async function update(item: ExecutiveAttentionItem, estado: "visto" | "descartado") {
    const response = await fetch("/api/eos-seguimientos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, estado }),
    });

    if (!response.ok) return;
    onUpdated?.();
  }

  return (
    <section className="attention-board" aria-label="Atención ejecutiva">
      <div className="attention-heading">
        <div>
          <span className="attention-label">ATENCIÓN EJECUTIVA</span>
          <h2>Lo que merece tu atención hoy</h2>
          <p>EOS priorizó impacto, urgencia y novedad. Solo muestra hasta {attention.daily_limit} señales para evitar ruido.</p>
        </div>
        <span className={`attention-state ${attention.interruption_recommended ? "urgent" : "calm"}`}>
          {attention.interruption_recommended ? "Conviene actuar" : "Sin urgencia crítica"}
        </span>
      </div>

      <div className="attention-list">
        {attention.items.map((item, index) => (
          <article className={`attention-item severity-${item.severidad}`} key={item.id}>
            <span className="attention-rank">0{index + 1}</span>
            <div className="attention-copy">
              <div className="attention-item-meta">
                <span>{item.severidad}</span>
                <span>prioridad {item.score}/100</span>
              </div>
              <h3>{item.titulo}</h3>
              <p>{item.mensaje}</p>
              <small>{item.razon}</small>
            </div>
            <div className="attention-actions">
              {onOpenChat && (
                <button type="button" onClick={() => {
                  void update(item, "visto");
                  onOpenChat(`EOS detectó esta señal: ${item.mensaje} Ayudame a decidir y preparar la ejecución de hoy.`);
                }}>
                  Preparar acción
                </button>
              )}
              <button className="dismiss-action" type="button" onClick={() => void update(item, "descartado")}>
                <X size={14} /> Omitir
              </button>
            </div>
          </article>
        ))}
      </div>

      {attention.suppressed_count > 0 && (
        <p className="attention-suppressed">
          EOS reservó {attention.suppressed_count} señal{attention.suppressed_count === 1 ? "" : "es"} de menor prioridad para no interrumpirte de más.
        </p>
      )}

      <style jsx>{`
        .attention-board { margin-top: 24px; padding: 28px; border: 1px solid #bfdbfe; border-radius: 28px; background: linear-gradient(145deg, #fff, #eff6ff); box-shadow: 0 20px 60px rgba(37,99,235,.08); }
        .attention-heading { display: flex; justify-content: space-between; gap: 22px; align-items: flex-start; }
        .attention-label { color: #2563eb; font-size: 9px; font-weight: 900; letter-spacing: .16em; }
        h2 { margin: 8px 0 0; color: #071226; font-size: 27px; letter-spacing: -.035em; }
        .attention-heading p { max-width: 700px; margin: 9px 0 0; color: #64748b; font-size: 11px; line-height: 1.6; }
        .attention-state { flex: 0 0 auto; padding: 8px 11px; border-radius: 999px; font-size: 9px; font-weight: 850; }
        .attention-state.urgent { background: #fff7ed; color: #c2410c; }
        .attention-state.calm { background: #ecfdf5; color: #047857; }
        .attention-list { display: grid; gap: 12px; margin-top: 22px; }
        .attention-item { display: grid; grid-template-columns: 44px minmax(0,1fr) auto; gap: 15px; align-items: center; padding: 17px; border: 1px solid #dbeafe; border-radius: 18px; background: rgba(255,255,255,.9); }
        .attention-item.severity-critica { border-left: 4px solid #dc2626; }
        .attention-item.severity-alta { border-left: 4px solid #f97316; }
        .attention-item.severity-media { border-left: 4px solid #2563eb; }
        .attention-rank { color: #93c5fd; font-size: 18px; font-weight: 950; }
        .attention-item-meta { display: flex; gap: 8px; color: #2563eb; font-size: 8px; font-weight: 900; text-transform: uppercase; }
        h3 { margin: 6px 0 0; color: #0f172a; font-size: 14px; }
        .attention-copy p { margin: 5px 0 0; color: #475569; font-size: 10px; line-height: 1.55; }
        .attention-copy small { display: block; margin-top: 5px; color: #94a3b8; font-size: 8px; }
        .attention-actions { display: flex; flex-direction: column; gap: 7px; }
        button { min-height: 34px; padding: 0 12px; border: 0; border-radius: 999px; background: #2563eb; color: white; font: 800 9px inherit; cursor: pointer; }
        .dismiss-action { display: inline-flex; align-items: center; justify-content: center; gap: 5px; background: #f1f5f9; color: #64748b; }
        .attention-suppressed { margin: 14px 0 0; color: #64748b; font-size: 9px; text-align: center; }
        @media (max-width: 760px) {
          .attention-heading { flex-direction: column; }
          .attention-item { grid-template-columns: 36px minmax(0,1fr); }
          .attention-actions { grid-column: 1 / -1; flex-direction: row; }
          .attention-actions button { flex: 1; }
        }
      `}</style>
    </section>
  );
}

function SignalCard({
  title,
  label,
  items,
  icon,
  tone,
  empty,
}: {
  title: string;
  label: string;
  items: BriefingItem[];
  icon: React.ReactNode;
  tone: "success" | "warning";
  empty: string;
}) {
  return (
    <article className={`signal-card signal-${tone}`}>
      <div className="signal-header">
        <span className="signal-icon">{icon}</span>
        <div>
          <span className="signal-label">{label}</span>
          <h2>{title}</h2>
        </div>
      </div>

      <div className="signal-list">
        {items.length ? (
          items.slice(0, 4).map((item, index) => (
            <div className="signal-item" key={`${item.titulo}-${index}`}>
              <span className="signal-dot" />
              <div>
                <strong>{item.titulo}</strong>
                {item.descripcion && <p>{item.descripcion}</p>}
              </div>
            </div>
          ))
        ) : (
          <p className="signal-empty">{empty}</p>
        )}
      </div>

      <style jsx>{`
        .signal-card {
          padding: 25px;
          border: 1px solid #dbeafe;
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.065);
        }

        .signal-success { border-color: #bbf7d0; }
        .signal-warning { border-color: #fed7aa; }

        .signal-header {
          display: flex;
          align-items: flex-start;
          gap: 13px;
        }

        .signal-icon {
          width: 44px;
          height: 44px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #ecfdf5;
          color: #059669;
        }

        .signal-warning .signal-icon {
          background: #fff7ed;
          color: #ea580c;
        }

        .signal-label {
          color: #059669;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .signal-warning .signal-label { color: #ea580c; }

        h2 {
          margin: 7px 0 0;
          color: #071226;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .signal-list {
          display: grid;
          gap: 11px;
          margin-top: 20px;
        }

        .signal-item {
          display: grid;
          grid-template-columns: 8px minmax(0, 1fr);
          gap: 10px;
          align-items: flex-start;
          padding: 12px;
          border-radius: 14px;
          background: #f8fafc;
        }

        .signal-dot {
          width: 7px;
          height: 7px;
          margin-top: 5px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 9px rgba(34, 197, 94, 0.42);
        }

        .signal-warning .signal-dot {
          background: #f97316;
          box-shadow: 0 0 9px rgba(249, 115, 22, 0.38);
        }

        .signal-item strong {
          color: #0f172a;
          font-size: 11px;
        }

        .signal-item p,
        .signal-empty {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 9px;
          line-height: 1.55;
        }

        .signal-empty { margin: 0; }
      `}</style>
    </article>
  );
}

function ScoreCard({
  score,
  estado,
}: {
  score: number;
  estado: string;
}) {
  return (
    <aside className="score-card">
      <div className="score-card-header">
        <span>EOS SCORE</span>

        <span className="score-status">
          {estado}
        </span>
      </div>

      <div className="score-value-row">
        <strong>{score}</strong>
        <span>%</span>
      </div>

      <div className="score-track">
        <div
          className="score-progress"
          style={{
            width: `${score}%`,
          }}
        />
      </div>

      <div className="score-info">
        <CircleGauge size={16} />

        <p>
          Nivel calculado según el contexto, actividad y progreso registrado.
        </p>
      </div>

      <style jsx>{`
        .score-card {
          padding: 24px;
          border: 1px solid rgba(37, 99, 235, 0.16);
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow:
            0 20px 60px rgba(37, 99, 235, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
        }

        .score-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          color: #64748b;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .score-status {
          padding: 6px 9px;
          border-radius: 999px;
          background: #eff6ff;
          color: #2563eb;
          font-size: 8px;
          letter-spacing: 0;
        }

        .score-value-row {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          margin-top: 20px;
        }

        .score-value-row strong {
          color: #071226;
          font-size: 58px;
          font-weight: 950;
          line-height: 0.85;
          letter-spacing: -0.06em;
        }

        .score-value-row span {
          color: #2563eb;
          font-size: 21px;
          font-weight: 900;
        }

        .score-track {
          height: 9px;
          overflow: hidden;
          margin-top: 24px;
          border-radius: 999px;
          background: #e9eff8;
        }

        .score-progress {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(
            90deg,
            #2563eb,
            #60a5fa
          );
          box-shadow: 0 0 18px rgba(37, 99, 235, 0.3);
          transition: width 700ms ease;
        }

        .score-info {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-top: 17px;
          color: #94a3b8;
        }

        .score-info p {
          margin: 0;
          font-size: 9px;
          line-height: 1.55;
        }
      `}</style>
    </aside>
  );
}

function PriorityCard({
  numero,
  titulo,
  texto,
  nivel,
  icono,
  destacada,
}: {
  numero: string;
  titulo: string;
  texto: string;
  nivel: string;
  icono: React.ReactNode;
  destacada: boolean;
}) {
  return (
    <article
      className={`priority-card ${
        destacada ? "priority-card-featured" : ""
      }`}
    >
      <div className="priority-top">
        <span className="priority-icon">
          {icono}
        </span>

        <span className="priority-number">
          {numero}
        </span>
      </div>

      <span
        className={`priority-level ${
          destacada ? "priority-level-featured" : ""
        }`}
      >
        {nivel}
      </span>

      <h3>{titulo}</h3>

      <p>{texto}</p>

      <div className="priority-footer">
        Acción recomendada
        <ArrowUpRight size={15} />
      </div>

      <style jsx>{`
        .priority-card {
          position: relative;
          min-height: 218px;
          display: flex;
          flex-direction: column;
          padding: 23px;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.17);
          border-radius: 25px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 17px 48px rgba(15, 23, 42, 0.065);
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .priority-card:hover {
          transform: translateY(-4px);
          border-color: rgba(37, 99, 235, 0.26);
          box-shadow: 0 23px 60px rgba(37, 99, 235, 0.1);
        }

        .priority-card-featured {
          border-color: rgba(37, 99, 235, 0.3);
          background:
            linear-gradient(
              145deg,
              #ffffff,
              #eff6ff
            );
        }

        .priority-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .priority-icon {
          width: 43px;
          height: 43px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #eff6ff;
          color: #2563eb;
        }

        .priority-number {
          color: #cbd5e1;
          font-size: 14px;
          font-weight: 900;
        }

        .priority-level {
          width: fit-content;
          margin-top: 20px;
          padding: 6px 9px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #64748b;
          font-size: 8px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .priority-level-featured {
          background: #dbeafe;
          color: #2563eb;
        }

        .priority-card h3 {
          margin: 15px 0 0;
          color: #071226;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.025em;
        }

        .priority-card p {
          margin: 10px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.65;
        }

        .priority-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: auto;
          padding-top: 22px;
          color: #2563eb;
          font-size: 9px;
          font-weight: 800;
        }
      `}</style>
    </article>
  );
}

function Step({
  numero,
  titulo,
  descripcion,
}: {
  numero: string;
  titulo: string;
  descripcion: string;
}) {
  return (
    <div className="step">
      <span className="step-number">
        {numero}
      </span>

      <div>
        <strong>{titulo}</strong>
        <p>{descripcion}</p>
      </div>

      <style jsx>{`
        .step {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr);
          gap: 12px;
          align-items: flex-start;
          padding: 13px;
          border: 1px solid #edf2f7;
          border-radius: 16px;
          background: #f8fbff;
        }

        .step-number {
          width: 32px;
          height: 32px;
          display: grid;
          place-items: center;
          border-radius: 11px;
          background: #2563eb;
          color: white;
          font-size: 10px;
          font-weight: 900;
          box-shadow: 0 9px 20px rgba(37, 99, 235, 0.18);
        }

        .step strong {
          color: #071226;
          font-size: 12px;
          font-weight: 850;
        }

        .step p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 10px;
          line-height: 1.55;
        }
      `}</style>
    </div>
  );
}

function normalizarScore(value?: number) {
  const numero = Number(value);

  if (!Number.isFinite(numero)) return 0;

  return Math.min(100, Math.max(0, Math.round(numero)));
}

function normalizeItems(value?: BriefingItem[]) {
  return Array.isArray(value)
    ? value.filter((item) => item?.titulo?.trim())
    : [];
}

function formatBriefingDate(value?: string | null) {
  if (!value) return "";

  const date = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-PY", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Asuncion",
  }).format(date);
}

function formatGeneratedTime(value?: string) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-PY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Asuncion",
  }).format(date);
}

function obtenerEstado(score: number) {
  if (score >= 80) return "Excelente";
  if (score >= 60) return "Estable";
  if (score >= 40) return "En progreso";
  if (score > 0) return "Inicial";
  return "Sin datos";
}
