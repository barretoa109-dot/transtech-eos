"use client";

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
  const score = Math.max(
    0,
    Math.min(Number(briefing.score) || 0, 100)
  );

  const estado = obtenerEstado(score);

  const prioridades = [
    {
      numero: "01",
      titulo: "Prioridad principal",
      texto:
        briefing.prioridad_1 ||
        "Definir el próximo objetivo importante.",
      nivel: "Alta",
    },
    {
      numero: "02",
      titulo: "Segunda prioridad",
      texto:
        briefing.prioridad_2 ||
        "Organizar la información disponible.",
      nivel: "Media",
    },
    {
      numero: "03",
      titulo: "Tercera prioridad",
      texto:
        briefing.prioridad_3 ||
        "Determinar la siguiente acción.",
      nivel: "Normal",
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.backgroundGlowOne} />
      <div style={styles.backgroundGlowTwo} />

      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.headerContent}>
            <div style={styles.eyebrowRow}>
              <span style={styles.liveDot} />

              <span style={styles.eyebrow}>
                BRIEFING INTELIGENTE
              </span>
            </div>

            <h1 style={styles.title}>
              {briefing.saludo || "Resumen ejecutivo"}
            </h1>

            <p style={styles.subtitle}>
              EOS analizó tu contexto actual y preparó este
              resumen con las prioridades que requieren atención.
            </p>
          </div>

          <div style={styles.scoreCard}>
            <div style={styles.scoreHeader}>
              <span style={styles.scoreLabel}>
                EOS SCORE
              </span>

              <span style={styles.scoreStatus}>
                {estado}
              </span>
            </div>

            <div style={styles.scoreContent}>
              <strong style={styles.scoreValue}>
                {score}
              </strong>

              <span style={styles.scorePercent}>%</span>
            </div>

            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressBar,
                  width: `${score}%`,
                }}
              />
            </div>

            <p style={styles.scoreDescription}>
              Nivel general calculado a partir del contexto,
              actividad y progreso registrado.
            </p>
          </div>
        </header>

        <section style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            ✦
          </div>

          <div style={styles.summaryContent}>
            <span style={styles.sectionEyebrow}>
              RESUMEN ACTUAL
            </span>

            <h2 style={styles.summaryTitle}>
              Panorama general
            </h2>

            <p style={styles.summaryText}>
              {briefing.resumen ||
                "EOS está listo para analizar tu situación cuando comiences a conversar."}
            </p>
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <span style={styles.sectionEyebrow}>
                FOCO INMEDIATO
              </span>

              <h2 style={styles.sectionTitle}>
                Prioridades detectadas
              </h2>
            </div>

            <span style={styles.sectionCount}>
              3 prioridades
            </span>
          </div>

          <div style={styles.priorityGrid}>
            {prioridades.map((prioridad, index) => (
              <PriorityCard
                key={prioridad.numero}
                numero={prioridad.numero}
                titulo={prioridad.titulo}
                texto={prioridad.texto}
                nivel={prioridad.nivel}
                destacada={index === 0}
              />
            ))}
          </div>
        </section>

        <div style={styles.bottomGrid}>
          <section style={styles.recommendationCard}>
            <div style={styles.recommendationTop}>
              <div style={styles.recommendationIcon}>
                ↗
              </div>

              <div>
                <span style={styles.sectionEyebrow}>
                  RECOMENDACIÓN PRINCIPAL
                </span>

                <h2 style={styles.recommendationTitle}>
                  Próxima decisión sugerida
                </h2>
              </div>
            </div>

            <p style={styles.recommendationText}>
              {briefing.recomendacion_principal ||
                "Contale a EOS qué querés lograr para recibir una recomendación más precisa."}
            </p>

            <div style={styles.recommendationFooter}>
              <span style={styles.recommendationDot} />

              <span>
                Recomendación generada según tu contexto actual
              </span>
            </div>
          </section>

          <section style={styles.stepsCard}>
            <div style={styles.stepsHeader}>
              <div>
                <span style={styles.sectionEyebrow}>
                  PLAN SUGERIDO
                </span>

                <h2 style={styles.stepsTitle}>
                  Próximos pasos
                </h2>
              </div>

              <span style={styles.stepsIcon}>⌁</span>
            </div>

            <div style={styles.stepsList}>
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

        <footer style={styles.footer}>
          <span style={styles.footerDot} />

          <span>
            El briefing se actualizará conforme EOS obtenga
            más información de tus conversaciones.
          </span>
        </footer>
      </div>
    </div>
  );
}

function PriorityCard({
  numero,
  titulo,
  texto,
  nivel,
  destacada,
}: {
  numero: string;
  titulo: string;
  texto: string;
  nivel: string;
  destacada: boolean;
}) {
  return (
    <article
      style={{
        ...styles.priorityCard,
        ...(destacada
          ? styles.priorityCardFeatured
          : {}),
      }}
    >
      <div style={styles.priorityTop}>
        <span
          style={{
            ...styles.priorityNumber,
            ...(destacada
              ? styles.priorityNumberFeatured
              : {}),
          }}
        >
          {numero}
        </span>

        <span
          style={{
            ...styles.priorityLevel,
            ...(destacada
              ? styles.priorityLevelFeatured
              : {}),
          }}
        >
          {nivel}
        </span>
      </div>

      <h3 style={styles.priorityTitle}>
        {titulo}
      </h3>

      <p style={styles.priorityText}>
        {texto}
      </p>

      <div style={styles.priorityFooter}>
        <span
          style={{
            ...styles.priorityLine,
            ...(destacada
              ? styles.priorityLineFeatured
              : {}),
          }}
        />

        <span style={styles.priorityFooterText}>
          Acción recomendada
        </span>
      </div>
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
    <div style={styles.step}>
      <div style={styles.stepNumber}>
        {numero}
      </div>

      <div style={styles.stepContent}>
        <strong style={styles.stepTitle}>
          {titulo}
        </strong>

        <p style={styles.stepDescription}>
          {descripcion}
        </p>
      </div>
    </div>
  );
}

function obtenerEstado(score: number) {
  if (score >= 80) return "Excelente";
  if (score >= 60) return "Estable";
  if (score >= 40) return "En progreso";
  if (score > 0) return "Inicial";
  return "Sin datos";
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "34px 28px 60px",
    background:
      "linear-gradient(180deg, #07101d 0%, #091524 48%, #07111f 100%)",
    color: "#f8fafc",
    fontFamily:
      "Inter, Arial, Helvetica, sans-serif",
  },

  backgroundGlowOne: {
    position: "fixed",
    top: 120,
    right: "7%",
    width: 430,
    height: 430,
    borderRadius: 999,
    background: "rgba(14, 165, 233, 0.08)",
    filter: "blur(115px)",
    pointerEvents: "none",
  },

  backgroundGlowTwo: {
    position: "fixed",
    bottom: 40,
    left: "25%",
    width: 340,
    height: 340,
    borderRadius: 999,
    background: "rgba(34, 211, 238, 0.045)",
    filter: "blur(105px)",
    pointerEvents: "none",
  },

  container: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: 1120,
    margin: "0 auto",
  },

  header: {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 24,
    marginBottom: 24,
  },

  headerContent: {
    flex: "1 1 520px",
    padding: "20px 0",
  },

  eyebrowRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: "#22d3ee",
    boxShadow: "0 0 11px rgba(34,211,238,0.8)",
  },

  eyebrow: {
    color: "#67e8f9",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.19em",
  },

  title: {
    margin: 0,
    color: "#f8fafc",
    fontSize: "clamp(32px, 5vw, 48px)",
    lineHeight: 1.1,
    fontWeight: 900,
    letterSpacing: "-0.045em",
  },

  subtitle: {
    maxWidth: 650,
    margin: "17px 0 0",
    color: "#8fa3bb",
    fontSize: 15,
    lineHeight: 1.7,
  },

  scoreCard: {
    flex: "0 1 285px",
    minWidth: 250,
    padding: 22,
    borderRadius: 22,
    border: "1px solid rgba(103,232,249,0.16)",
    background:
      "linear-gradient(145deg, rgba(18,38,60,0.96), rgba(11,25,42,0.96))",
    boxShadow:
      "0 20px 45px rgba(2,8,23,0.24), inset 0 1px 0 rgba(255,255,255,0.035)",
  },

  scoreHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  scoreLabel: {
    color: "#7f93aa",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.14em",
  },

  scoreStatus: {
    padding: "6px 9px",
    borderRadius: 999,
    background: "rgba(34,211,238,0.08)",
    border: "1px solid rgba(34,211,238,0.12)",
    color: "#67e8f9",
    fontSize: 9,
    fontWeight: 850,
  },

  scoreContent: {
    display: "flex",
    alignItems: "flex-end",
    marginTop: 18,
  },

  scoreValue: {
    color: "#f8fafc",
    fontSize: 52,
    lineHeight: 0.9,
    fontWeight: 950,
    letterSpacing: "-0.055em",
  },

  scorePercent: {
    marginLeft: 4,
    color: "#67e8f9",
    fontSize: 18,
    fontWeight: 900,
  },

  progressTrack: {
    height: 8,
    marginTop: 20,
    overflow: "hidden",
    borderRadius: 999,
    background: "rgba(148,163,184,0.12)",
  },

  progressBar: {
    height: "100%",
    borderRadius: 999,
    background:
      "linear-gradient(90deg, #22d3ee, #0ea5e9)",
    boxShadow: "0 0 15px rgba(34,211,238,0.35)",
  },

  scoreDescription: {
    margin: "13px 0 0",
    color: "#647a93",
    fontSize: 10,
    lineHeight: 1.55,
  },

  summaryCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 18,
    padding: 24,
    borderRadius: 22,
    border: "1px solid rgba(148,163,184,0.13)",
    background:
      "linear-gradient(145deg, rgba(18,36,57,0.94), rgba(12,27,45,0.86))",
    boxShadow:
      "0 18px 38px rgba(2,8,23,0.18), inset 0 1px 0 rgba(255,255,255,0.03)",
  },

  summaryIcon: {
    width: 49,
    height: 49,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    background:
      "linear-gradient(135deg, #67e8f9, #22d3ee)",
    color: "#083344",
    fontSize: 20,
    fontWeight: 900,
    boxShadow: "0 12px 24px rgba(14,165,233,0.2)",
  },

  summaryContent: {
    minWidth: 0,
    flex: 1,
  },

  sectionEyebrow: {
    color: "#5f8197",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.15em",
  },

  summaryTitle: {
    margin: "7px 0 10px",
    color: "#f4fbff",
    fontSize: 21,
    fontWeight: 850,
    letterSpacing: "-0.025em",
  },

  summaryText: {
    margin: 0,
    color: "#a5b5c8",
    fontSize: 14,
    lineHeight: 1.75,
  },

  section: {
    marginTop: 27,
  },

  sectionHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 15,
    marginBottom: 15,
  },

  sectionTitle: {
    margin: "6px 0 0",
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: 875,
    letterSpacing: "-0.035em",
  },

  sectionCount: {
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(148,163,184,0.07)",
    border: "1px solid rgba(148,163,184,0.1)",
    color: "#7388a0",
    fontSize: 9,
    fontWeight: 800,
  },

  priorityGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(250px, 1fr))",
    gap: 14,
  },

  priorityCard: {
    minHeight: 205,
    display: "flex",
    flexDirection: "column",
    padding: 20,
    borderRadius: 19,
    border: "1px solid rgba(148,163,184,0.12)",
    background:
      "linear-gradient(145deg, rgba(17,34,54,0.91), rgba(11,25,42,0.9))",
    boxShadow: "0 15px 32px rgba(2,8,23,0.15)",
  },

  priorityCardFeatured: {
    border: "1px solid rgba(34,211,238,0.23)",
    background:
      "linear-gradient(145deg, rgba(13,55,72,0.85), rgba(10,31,49,0.94))",
  },

  priorityTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 21,
  },

  priorityNumber: {
    color: "#526a83",
    fontSize: 20,
    fontWeight: 950,
    letterSpacing: "-0.04em",
  },

  priorityNumberFeatured: {
    color: "#67e8f9",
  },

  priorityLevel: {
    padding: "6px 9px",
    borderRadius: 999,
    background: "rgba(148,163,184,0.07)",
    color: "#6e8299",
    fontSize: 8,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  priorityLevelFeatured: {
    background: "rgba(34,211,238,0.09)",
    color: "#67e8f9",
  },

  priorityTitle: {
    margin: "0 0 9px",
    color: "#edf8ff",
    fontSize: 15,
    fontWeight: 850,
  },

  priorityText: {
    flex: 1,
    margin: 0,
    color: "#879bb2",
    fontSize: 12,
    lineHeight: 1.65,
  },

  priorityFooter: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginTop: 20,
  },

  priorityLine: {
    width: 23,
    height: 2,
    borderRadius: 99,
    background: "#344c64",
  },

  priorityLineFeatured: {
    background: "#22d3ee",
    boxShadow: "0 0 8px rgba(34,211,238,0.4)",
  },

  priorityFooterText: {
    color: "#536a83",
    fontSize: 9,
    fontWeight: 750,
  },

  bottomGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(330px, 1fr))",
    gap: 16,
    marginTop: 18,
  },

  recommendationCard: {
    padding: 23,
    borderRadius: 21,
    border: "1px solid rgba(34,211,238,0.18)",
    background:
      "linear-gradient(145deg, rgba(8,71,88,0.38), rgba(10,31,49,0.9))",
    boxShadow: "0 18px 37px rgba(2,8,23,0.17)",
  },

  recommendationTop: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },

  recommendationIcon: {
    width: 43,
    height: 43,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    background: "rgba(34,211,238,0.12)",
    border: "1px solid rgba(34,211,238,0.16)",
    color: "#67e8f9",
    fontSize: 18,
    fontWeight: 900,
  },

  recommendationTitle: {
    margin: "5px 0 0",
    color: "#e9fbff",
    fontSize: 18,
    fontWeight: 850,
  },

  recommendationText: {
    margin: "22px 0",
    color: "#b3cbd6",
    fontSize: 14,
    lineHeight: 1.75,
  },

  recommendationFooter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingTop: 15,
    borderTop: "1px solid rgba(103,232,249,0.1)",
    color: "#568092",
    fontSize: 9,
    fontWeight: 700,
  },

  recommendationDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: "#22d3ee",
    boxShadow: "0 0 7px rgba(34,211,238,0.55)",
  },

  stepsCard: {
    padding: 23,
    borderRadius: 21,
    border: "1px solid rgba(148,163,184,0.12)",
    background:
      "linear-gradient(145deg, rgba(17,34,54,0.94), rgba(11,25,42,0.91))",
    boxShadow: "0 18px 37px rgba(2,8,23,0.16)",
  },

  stepsHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 15,
    marginBottom: 20,
  },

  stepsTitle: {
    margin: "5px 0 0",
    color: "#f1f8ff",
    fontSize: 18,
    fontWeight: 850,
  },

  stepsIcon: {
    color: "#4c657f",
    fontSize: 22,
  },

  stepsList: {
    display: "grid",
    gap: 16,
  },

  step: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
  },

  stepNumber: {
    width: 29,
    height: 29,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    background: "rgba(34,211,238,0.09)",
    border: "1px solid rgba(34,211,238,0.12)",
    color: "#67e8f9",
    fontSize: 10,
    fontWeight: 900,
  },

  stepContent: {
    minWidth: 0,
  },

  stepTitle: {
    color: "#dceaf5",
    fontSize: 12,
    fontWeight: 820,
  },

  stepDescription: {
    margin: "4px 0 0",
    color: "#71869e",
    fontSize: 10,
    lineHeight: 1.55,
  },

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 24,
    color: "#52677f",
    fontSize: 9,
    lineHeight: 1.5,
    textAlign: "center",
  },

  footerDot: {
    width: 5,
    height: 5,
    flexShrink: 0,
    borderRadius: 999,
    background: "#22c55e",
  },
};