"use client";

type Conversacion = {
  id: string;
  titulo: string | null;
  created_at?: string;
};

type Vista = "chat" | "briefing" | "dashboard" | "perfil";

type SidebarProps = {
  nombre: string;
  plan: string;
  vista: Vista;
  busqueda: string;
  conversacionId: string;
  conversaciones: Conversacion[];
  onVistaChange: (vista: Vista) => void;
  onBusquedaChange: (value: string) => void;
  onNuevoChat: () => void;
  onAbrirConversacion: (id: string) => void;
};

export default function Sidebar({
  nombre,
  plan,
  vista,
  busqueda,
  conversacionId,
  conversaciones,
  onVistaChange,
  onBusquedaChange,
  onNuevoChat,
  onAbrirConversacion,
}: SidebarProps) {
  const conversacionesFiltradas = conversaciones.filter((c) =>
    (c.titulo || "Nuevo chat").toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <aside style={styles.sidebar}>
      <div style={styles.sidebarHeader}>
        <div style={styles.brand}>
          <div style={styles.logoWrap}>
            <div style={styles.logoGlow} />
            <div style={styles.logo}>E</div>
          </div>

          <div>
            <div style={styles.brandSmall}>TransTech</div>
            <div style={styles.brandTitle}>EOS</div>
          </div>
        </div>

        <button onClick={onNuevoChat} style={styles.newChat}>
          + Nuevo chat
        </button>

        <input
          value={busqueda}
          onChange={(e) => onBusquedaChange(e.target.value)}
          placeholder="Buscar conversaciones..."
          style={styles.search}
        />

        <nav style={styles.nav}>
          <button
            onClick={() => onVistaChange("chat")}
            style={vista === "chat" ? styles.navActive : styles.navItem}
          >
            Inicio
          </button>

          <button
            onClick={() => onVistaChange("briefing")}
            style={vista === "briefing" ? styles.navActive : styles.navItem}
          >
            Briefing
          </button>

          <button
            onClick={() => onVistaChange("dashboard")}
            style={vista === "dashboard" ? styles.navActive : styles.navItem}
          >
            Dashboard
          </button>
        </nav>
      </div>

      <div style={styles.history}>
        <p style={styles.sectionTitle}>Recientes</p>

        {conversacionesFiltradas.length === 0 && (
          <p style={styles.empty}>Todavía no hay conversaciones.</p>
        )}

        {conversacionesFiltradas.map((c) => (
          <button
            key={c.id}
            onClick={() => onAbrirConversacion(c.id)}
            style={c.id === conversacionId ? styles.chatActive : styles.chatItem}
          >
            {c.titulo || "Nuevo chat"}
          </button>
        ))}
      </div>

      <button onClick={() => onVistaChange("perfil")} style={styles.userBox}>
        <div style={styles.userAvatar}>{nombre.charAt(0).toUpperCase()}</div>
        <div style={styles.userText}>
          <strong>{nombre}</strong>
          <span>Plan {plan}</span>
        </div>
      </button>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    height: "100vh",
    borderRight: "1px solid #e5e7eb",
    background: "#f7f7f8",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  sidebarHeader: {
    padding: 16,
    flexShrink: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  logoWrap: {
    position: "relative",
    width: 44,
    height: 44,
  },
  logoGlow: {
    position: "absolute",
    inset: -4,
    background: "linear-gradient(135deg,#22d3ee,#0ea5e9)",
    opacity: 0.25,
    filter: "blur(10px)",
    borderRadius: 16,
  },
  logo: {
    position: "relative",
    width: 44,
    height: 44,
    borderRadius: 15,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 20,
    color: "#06202a",
    boxShadow: "0 10px 24px rgba(34,211,238,.25)",
  },
  brandSmall: {
    fontSize: 13,
    color: "#0891b2",
    fontWeight: 800,
    lineHeight: 1,
  },
  brandTitle: {
    fontSize: 29,
    fontWeight: 900,
    lineHeight: 1.05,
    letterSpacing: "-0.04em",
  },
  newChat: {
    width: "100%",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    borderRadius: 14,
    padding: "13px 14px",
    textAlign: "left",
    fontWeight: 800,
    cursor: "pointer",
    marginBottom: 10,
  },
  search: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 14,
    padding: "13px 14px",
    outline: "none",
    marginBottom: 16,
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  nav: {
    display: "grid",
    gap: 5,
  },
  navItem: {
    border: "none",
    background: "transparent",
    color: "#374151",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 15,
  },
  navActive: {
    border: "none",
    background: "#e0f7ff",
    color: "#075985",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 15,
  },
  history: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "0 16px 16px",
  },
  sectionTitle: {
    margin: "8px 0",
    color: "#6b7280",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: ".1em",
    fontWeight: 900,
  },
  empty: {
    color: "#9ca3af",
    fontSize: 14,
  },
  chatItem: {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "#4b5563",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    marginBottom: 4,
    fontSize: 15,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatActive: {
    width: "100%",
    border: "none",
    background: "#ffffff",
    color: "#111827",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 800,
    marginBottom: 4,
    fontSize: 15,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    boxShadow: "0 8px 20px rgba(15,23,42,.05)",
  },
  userBox: {
    flexShrink: 0,
    padding: 16,
    border: "none",
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    alignItems: "center",
    gap: 11,
    background: "#f7f7f8",
    cursor: "pointer",
    textAlign: "left",
  },
  userAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    background: "#22d3ee",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    color: "#06202a",
  },
  userText: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
};