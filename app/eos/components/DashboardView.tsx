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
  return (
    <div style={styles.panelPage}>
      <p style={styles.eyebrow}>Dashboard EOS</p>
      <h2 style={styles.title}>Centro de control</h2>

      <p style={styles.panelText}>
        Vista general del estado actual del usuario dentro de EOS.
      </p>

      <div style={styles.cardGrid}>
        <Metric label="EOS Score" value={score || 0} hint="Estado inteligente" />
        <Metric label="Conversaciones" value={conversaciones} hint="Procesos registrados" />
        <Metric label="Plan" value={plan} hint="Acceso actual" />
      </div>

      <div style={styles.dashboardGrid}>
        <div style={styles.dashboardBlock}>
          <h3>Actividad reciente</h3>
          <p>Último chat activo: {ultimoChat || "Sin actividad reciente"}</p>
          <p>Mensajes cargados: {mensajes}</p>
        </div>

        <div style={styles.dashboardBlock}>
          <h3>Capacidades activas</h3>
          <p>Chat inteligente</p>
          <p>Generación de archivos</p>
          <p>Briefing diario</p>
          <p>Historial de conversaciones</p>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div style={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
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
    fontSize: 30,
  },
  panelText: {
    color: "#4b5563",
    lineHeight: 1.7,
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
    marginTop: 20,
  },
  metricCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 18,
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    boxShadow: "0 10px 30px rgba(0,0,0,.035)",
  },
  dashboardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
    marginTop: 18,
  },
  dashboardBlock: {
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 20,
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(0,0,0,.035)",
    lineHeight: 1.7,
  },
};