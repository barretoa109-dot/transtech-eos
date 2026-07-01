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

export default function BriefingView({ briefing }: BriefingViewProps) {
  return (
    <div style={styles.panelPage}>
      <div style={styles.panelTop}>
        <div>
          <p style={styles.eyebrow}>Briefing inteligente</p>
          <h2 style={styles.title}>{briefing.saludo}</h2>
        </div>

        <div style={styles.score}>{briefing.score || 0}</div>
      </div>

      <div style={styles.hero}>
        <h3>Resumen actual</h3>
        <p>{briefing.resumen}</p>
      </div>

      <div style={styles.cardGrid}>
        <div style={styles.card}>
          <span>Prioridad 1</span>
          <strong>{briefing.prioridad_1}</strong>
        </div>

        <div style={styles.card}>
          <span>Prioridad 2</span>
          <strong>{briefing.prioridad_2}</strong>
        </div>

        <div style={styles.card}>
          <span>Prioridad 3</span>
          <strong>{briefing.prioridad_3}</strong>
        </div>
      </div>

      <div style={styles.recommendation}>
        <strong>Recomendación principal</strong>
        <p>{briefing.recomendacion_principal}</p>
      </div>

      <div style={styles.timelineBox}>
        <h3>Próximos pasos sugeridos</h3>
        <p>1. Contar a EOS el contexto actual.</p>
        <p>2. Definir una meta concreta.</p>
        <p>3. Pedir un plan, documento o tablero de apoyo.</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panelPage: {
    maxWidth: 850,
    width: "100%",
    margin: "0 auto",
    padding: "42px 24px",
    overflowY: "auto",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  panelTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
  },
  eyebrow: {
    margin: 0,
    color: "#0891b2",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: ".1em",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 8,
    fontSize: 28,
  },
  score: {
    width: 64,
    height: 64,
    borderRadius: 20,
    background: "#22d3ee",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 24,
    color: "#06202a",
  },
  hero: {
    marginTop: 24,
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 20,
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(0,0,0,.035)",
    lineHeight: 1.7,
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
    marginTop: 20,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
    background: "#f9fafb",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  recommendation: {
    marginTop: 16,
    background: "#ecfeff",
    border: "1px solid #bae6fd",
    borderRadius: 14,
    padding: 16,
    color: "#075985",
    fontWeight: 700,
  },
  timelineBox: {
    marginTop: 18,
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 20,
    background: "#f9fafb",
    lineHeight: 1.8,
  },
};