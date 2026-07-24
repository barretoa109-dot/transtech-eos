"use client";

import {
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  CircleGauge,
  Lightbulb,
  ListChecks,
  Sparkles,
  Target,
} from "lucide-react";

type Briefing = {
  saludo?: string;
  resumen?: string;
  prioridad_1?: string;
  prioridad_2?: string;
  prioridad_3?: string;
  recomendacion_principal?: string;
  score?: number;
};

type BriefingViewProps = {
  briefing: Briefing;
};

export default function BriefingView({
  briefing,
}: BriefingViewProps) {
  const score = normalizarScore(briefing.score);
  const estado = obtenerEstado(score);

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
            <div className="briefing-eyebrow">
              <span className="briefing-live-dot" />
              BRIEFING INTELIGENTE
            </div>

            <h1>
              {briefing.saludo || "Resumen ejecutivo"}
            </h1>

            <p>
              EOS analizó tu contexto actual y preparó un panorama claro con
              las prioridades, decisiones y próximos pasos que requieren tu
              atención.
            </p>
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
          </div>
        </section>

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
              <Step
                numero="1"
                titulo="Compartí el contexto"
                descripcion="Explicale a EOS la situación actual y el resultado que esperás."
              />

              <Step
                numero="2"
                titulo="Definí una meta concreta"
                descripcion="Convertí la necesidad principal en un objetivo medible."
              />

              <Step
                numero="3"
                titulo="Ejecutá el próximo paso"
                descripcion="Pedí un plan, documento, análisis o automatización."
              />
            </div>
          </section>
        </div>

        <footer className="briefing-footer">
          <span className="briefing-footer-dot" />

          El briefing se actualizará a medida que EOS obtenga más información
          de tus conversaciones.
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
        }
      `}</style>
    </main>
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

function obtenerEstado(score: number) {
  if (score >= 80) return "Excelente";
  if (score >= 60) return "Estable";
  if (score >= 40) return "En progreso";
  if (score > 0) return "Inicial";
  return "Sin datos";
}