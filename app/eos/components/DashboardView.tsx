"use client";

type DashboardViewProps = {
  score: number;
  conversaciones: number;
  mensajes: number;
  plan: string;
  ultimoChat?: string | null;
};

export default function DashboardView({
  score,
  conversaciones,
  mensajes,
  plan,
  ultimoChat,
}: DashboardViewProps) {
  const progreso = Math.max(0, Math.min(score || 0, 100));

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <span style={styles.badge}>TRANSTECH EOS</span>

          <h1 style={styles.title}>
            Centro de Control
          </h1>

          <p style={styles.subtitle}>
            Resumen general del estado de tu espacio de trabajo.
          </p>
        </div>

        <div style={styles.scoreCard}>
          <span style={styles.scoreLabel}>
            EOS SCORE
          </span>

          <strong style={styles.scoreValue}>
            {progreso}%
          </strong>

          <div style={styles.progressBackground}>
            <div
              style={{
                ...styles.progressBar,
                width: `${progreso}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div style={styles.metrics}>
        <Metric
          icon="💬"
          title="Conversaciones"
          value={conversaciones}
          color="#22d3ee"
        />

        <Metric
          icon="📝"
          title="Mensajes"
          value={mensajes}
          color="#60a5fa"
        />

        <Metric
          icon="⭐"
          title="Plan"
          value={plan}
          color="#38bdf8"
        />
      </div>

      <div style={styles.grid}>
        <section style={styles.card}>
          <h3 style={styles.cardTitle}>
            Actividad reciente
          </h3>

          <div style={styles.activity}>
            <Item
              title="Último chat"
              value={
                ultimoChat ||
                "Todavía no existe actividad."
              }
            />

            <Item
              title="Mensajes registrados"
              value={mensajes.toString()}
            />

            <Item
              title="Conversaciones"
              value={conversaciones.toString()}
            />
          </div>
        </section>

        <section style={styles.card}>
          <h3 style={styles.cardTitle}>
            Capacidades disponibles
          </h3>

          <ul style={styles.list}>
            <li>✓ Chat inteligente</li>
            <li>✓ Memoria contextual</li>
            <li>✓ Generación de archivos</li>
            <li>✓ Dashboard ejecutivo</li>
            <li>✓ Historial</li>
            <li>✓ Briefings</li>
          </ul>
        </section>
      </div>

      <div style={styles.recommendations}>
        <h3 style={styles.cardTitle}>
          Recomendaciones de EOS
        </h3>

        <div style={styles.recommendationGrid}>
          <Recommendation text="Continuá construyendo historial para mejorar la memoria." />
          <Recommendation text="Organizá objetivos para obtener mejores seguimientos." />
          <Recommendation text="Generá documentos desde EOS para aprovechar las automatizaciones." />
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon,
  title,
  value,
  color,
}: {
  icon: string;
  title: string;
  value: string | number;
  color: string;
}) {
  return (
    <div style={styles.metric}>
      <div
        style={{
          ...styles.metricIcon,
          background: color,
        }}
      >
        {icon}
      </div>

      <div>
        <div style={styles.metricTitle}>
          {title}
        </div>

        <strong style={styles.metricValue}>
          {value}
        </strong>
      </div>
    </div>
  );
}

function Item({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div style={styles.item}>
      <span style={styles.itemTitle}>
        {title}
      </span>

      <strong style={styles.itemValue}>
        {value}
      </strong>
    </div>
  );
}

function Recommendation({
  text,
}: {
  text: string;
}) {
  return (
    <div style={styles.recommendation}>
      ✦ {text}
    </div>
  );
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    maxWidth: 1150,
    margin: "0 auto",
    padding: 35,
    color: "#fff",
    fontFamily: "Inter, Arial",
  },

  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: 30,
    marginBottom: 30,
    flexWrap: "wrap",
  },

  badge: {
    color: "#67e8f9",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: ".18em",
  },

  title: {
    margin: "12px 0",
    fontSize: 42,
    fontWeight: 900,
  },

  subtitle: {
    color: "#8da2bb",
    maxWidth: 520,
    lineHeight: 1.7,
  },

  scoreCard: {
    width: 260,
    borderRadius: 22,
    padding: 24,
    background: "#132238",
    border: "1px solid #23415f",
  },

  scoreLabel: {
    color: "#8da2bb",
    fontSize: 12,
  },

  scoreValue: {
    display: "block",
    marginTop: 8,
    marginBottom: 18,
    fontSize: 48,
    fontWeight: 900,
  },

  progressBackground: {
    height: 10,
    borderRadius: 999,
    background: "#233b57",
    overflow: "hidden",
  },

  progressBar: {
    height: "100%",
    background:
      "linear-gradient(90deg,#22d3ee,#0ea5e9)",
  },

  metrics: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(220px,1fr))",
    gap: 18,
    marginBottom: 24,
  },

  metric: {
    display: "flex",
    gap: 15,
    alignItems: "center",
    borderRadius: 18,
    padding: 20,
    background: "#132238",
    border: "1px solid #23415f",
  },

  metricIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 24,
  },

  metricTitle: {
    color: "#8da2bb",
    fontSize: 13,
  },

  metricValue: {
    fontSize: 26,
    fontWeight: 900,
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(330px,1fr))",
    gap: 22,
    marginBottom: 22,
  },

  card: {
    background: "#132238",
    border: "1px solid #23415f",
    borderRadius: 20,
    padding: 24,
  },

  cardTitle: {
    marginTop: 0,
    marginBottom: 18,
    fontSize: 20,
  },

  activity: {
    display: "grid",
    gap: 14,
  },

  item: {
    display: "flex",
    justifyContent: "space-between",
    borderBottom:
      "1px solid rgba(255,255,255,.06)",
    paddingBottom: 10,
  },

  itemTitle: {
    color: "#8da2bb",
  },

  itemValue: {
    textAlign: "right",
  },

  list: {
    margin: 0,
    paddingLeft: 18,
    lineHeight: 2,
    color: "#d4e3f3",
  },

  recommendations: {
    background: "#132238",
    border: "1px solid #23415f",
    borderRadius: 20,
    padding: 24,
  },

  recommendationGrid: {
    display: "grid",
    gap: 14,
    marginTop: 18,
  },

  recommendation: {
    padding: 16,
    borderRadius: 14,
    background: "#1b314c",
    color: "#d9f4ff",
  },
};