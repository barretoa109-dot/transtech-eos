"use client";

type ProfileViewProps = {
  nombre: string;
  plan: string;
  usuarioId: string;
  conversaciones: number;
  mensajes: number;
};

export default function ProfileView({
  nombre,
  plan,
  usuarioId,
  conversaciones,
  mensajes,
}: ProfileViewProps) {
  return (
    <div style={styles.panelPage}>
      <p style={styles.eyebrow}>Perfil EOS</p>
      <h2 style={styles.title}>{nombre}</h2>

      <div style={styles.profileBox}>
        <div style={styles.bigAvatar}>{nombre.charAt(0).toUpperCase()}</div>

        <div>
          <h3 style={styles.profileName}>{nombre}</h3>
          <p>Plan actual: {plan}</p>
          <p>Estado: EOS activo</p>
          <p style={styles.userId}>Usuario ID: {usuarioId || "No disponible"}</p>
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.block}>
          <h3>Uso del sistema</h3>
          <p>Conversaciones: {conversaciones}</p>
          <p>Mensajes en chat actual: {mensajes}</p>
        </div>

        <div style={styles.block}>
          <h3>Funciones disponibles</h3>
          <p>Asesor EOS</p>
          <p>Briefing inteligente</p>
          <p>Documentos profesionales</p>
          <p>Dashboard básico</p>
        </div>
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
  profileBox: {
    border: "1px solid #e5e7eb",
    borderRadius: 20,
    padding: 22,
    display: "flex",
    alignItems: "center",
    gap: 18,
    background: "#ffffff",
    boxShadow: "0 12px 35px rgba(0,0,0,.04)",
  },
  bigAvatar: {
    width: 70,
    height: 70,
    borderRadius: 24,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 30,
    color: "#06202a",
  },
  profileName: {
    margin: "0 0 8px",
  },
  userId: {
    color: "#64748b",
    fontSize: 13,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
    marginTop: 18,
  },
  block: {
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 20,
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(0,0,0,.035)",
    lineHeight: 1.7,
  },
};