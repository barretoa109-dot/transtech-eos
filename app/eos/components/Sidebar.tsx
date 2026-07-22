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

type NavButtonProps = {
  icono: string;
  texto: string;
  activo: boolean;
  onClick: () => void;
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
  const conversacionesFiltradas = conversaciones.filter((conversacion) =>
    (conversacion.titulo || "Nuevo chat")
      .toLowerCase()
      .includes(busqueda.toLowerCase())
  );

  const iniciales =
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join("") || "U";

  const planFormateado =
    plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase();

  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>
        <div style={styles.brand}>
          <div style={styles.logoContainer}>
            <div style={styles.logoGlow} />
            <div style={styles.logo}>T</div>
          </div>

          <div style={styles.brandText}>
            <span style={styles.companyName}>TRANSTECH</span>
            <div style={styles.productRow}>
              <strong style={styles.productName}>EOS</strong>
              <span style={styles.version}>BETA</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onNuevoChat}
          style={styles.newChatButton}
        >
          <span style={styles.newChatIcon}>＋</span>

          <span style={styles.newChatContent}>
            <strong style={styles.newChatTitle}>Nuevo chat</strong>
            <small style={styles.newChatSubtitle}>
              Iniciar conversación
            </small>
          </span>

          <span style={styles.newChatArrow}>›</span>
        </button>

        <div style={styles.searchWrapper}>
          <span style={styles.searchIcon}>⌕</span>

          <input
            value={busqueda}
            onChange={(event) => onBusquedaChange(event.target.value)}
            placeholder="Buscar conversaciones"
            aria-label="Buscar conversaciones"
            style={styles.search}
          />

          {busqueda && (
            <button
              type="button"
              onClick={() => onBusquedaChange("")}
              aria-label="Limpiar búsqueda"
              style={styles.clearSearch}
            >
              ×
            </button>
          )}
        </div>

        <nav style={styles.navigation}>
          <NavButton
            icono="✦"
            texto="EOS"
            activo={vista === "chat"}
            onClick={() => onVistaChange("chat")}
          />

          <NavButton
            icono="◈"
            texto="Briefing"
            activo={vista === "briefing"}
            onClick={() => onVistaChange("briefing")}
          />

          <NavButton
            icono="▦"
            texto="Dashboard"
            activo={vista === "dashboard"}
            onClick={() => onVistaChange("dashboard")}
          />
        </nav>
      </div>

      <div style={styles.divider} />

      <section style={styles.history}>
        <div style={styles.historyHeader}>
          <p style={styles.sectionTitle}>Conversaciones</p>

          <span style={styles.conversationCount}>
            {conversacionesFiltradas.length}
          </span>
        </div>

        {conversacionesFiltradas.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>◇</div>

            <p style={styles.emptyTitle}>
              {busqueda
                ? "No encontramos resultados"
                : "Todavía no hay conversaciones"}
            </p>

            <span style={styles.emptyText}>
              {busqueda
                ? "Probá buscando con otras palabras."
                : "Iniciá un nuevo chat para comenzar."}
            </span>
          </div>
        ) : (
          <div style={styles.conversationList}>
            {conversacionesFiltradas.map((conversacion) => {
              const activa = conversacion.id === conversacionId;

              return (
                <button
                  type="button"
                  key={conversacion.id}
                  onClick={() =>
                    onAbrirConversacion(conversacion.id)
                  }
                  title={conversacion.titulo || "Nuevo chat"}
                  style={{
                    ...styles.conversationButton,
                    ...(activa
                      ? styles.conversationButtonActive
                      : {}),
                  }}
                >
                  <span
                    style={{
                      ...styles.conversationIcon,
                      ...(activa
                        ? styles.conversationIconActive
                        : {}),
                    }}
                  >
                    ◇
                  </span>

                  <span style={styles.conversationTitle}>
                    {conversacion.titulo || "Nuevo chat"}
                  </span>

                  {activa && <span style={styles.activeDot} />}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div style={styles.footer}>
        <button
          type="button"
          onClick={() => onVistaChange("perfil")}
          style={{
            ...styles.profileButton,
            ...(vista === "perfil" ? styles.profileButtonActive : {}),
          }}
        >
          <div style={styles.avatarWrapper}>
            <div style={styles.avatar}>{iniciales}</div>
            <span style={styles.onlineDot} />
          </div>

          <div style={styles.profileInfo}>
            <strong style={styles.profileName}>{nombre}</strong>

            <span style={styles.profilePlan}>
              Plan {planFormateado}
            </span>
          </div>

          <span style={styles.profileArrow}>›</span>
        </button>

        <div style={styles.connectionStatus}>
          <span style={styles.connectionDot} />
          <span>EOS conectado</span>
        </div>
      </div>
    </aside>
  );
}

function NavButton({
  icono,
  texto,
  activo,
  onClick,
}: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.navButton,
        ...(activo ? styles.navButtonActive : {}),
      }}
    >
      <span
        style={{
          ...styles.navIcon,
          ...(activo ? styles.navIconActive : {}),
        }}
      >
        {icono}
      </span>

      <span>{texto}</span>

      {activo && <span style={styles.navIndicator} />}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: "100%",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background:
      "linear-gradient(180deg, #0b1424 0%, #08111f 100%)",
    borderRight: "1px solid rgba(148, 163, 184, 0.14)",
    color: "#f8fafc",
    fontFamily:
      "Inter, Arial, Helvetica, sans-serif",
    boxShadow: "14px 0 40px rgba(2, 8, 23, 0.16)",
  },

  header: {
    padding: "20px 16px 14px",
    flexShrink: 0,
  },

  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "0 5px",
    marginBottom: 22,
  },

  logoContainer: {
    position: "relative",
    width: 44,
    height: 44,
    flexShrink: 0,
  },

  logoGlow: {
    position: "absolute",
    inset: -5,
    borderRadius: 16,
    background:
      "linear-gradient(135deg, #22d3ee, #0ea5e9)",
    opacity: 0.32,
    filter: "blur(11px)",
  },

  logo: {
    position: "relative",
    width: 44,
    height: 44,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "linear-gradient(135deg, #67e8f9 0%, #22d3ee 45%, #0ea5e9 100%)",
    color: "#042f3e",
    fontSize: 21,
    fontWeight: 950,
    boxShadow:
      "0 12px 26px rgba(14, 165, 233, 0.28)",
  },

  brandText: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  companyName: {
    color: "#67e8f9",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.19em",
  },

  productRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  productName: {
    color: "#ffffff",
    fontSize: 27,
    lineHeight: 1,
    fontWeight: 950,
    letterSpacing: "-0.045em",
  },

  version: {
    padding: "4px 6px",
    borderRadius: 6,
    background: "rgba(34, 211, 238, 0.12)",
    border: "1px solid rgba(34, 211, 238, 0.22)",
    color: "#67e8f9",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.08em",
  },

  newChatButton: {
    width: "100%",
    minHeight: 60,
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    marginBottom: 12,
    border: "1px solid rgba(103, 232, 249, 0.28)",
    borderRadius: 16,
    background:
      "linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(34, 211, 238, 0.09))",
    color: "#ffffff",
    cursor: "pointer",
    textAlign: "left",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 24px rgba(2,8,23,0.18)",
  },

  newChatIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    background:
      "linear-gradient(135deg, #67e8f9, #22d3ee)",
    color: "#083344",
    fontSize: 22,
    fontWeight: 900,
  },

  newChatContent: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  newChatTitle: {
    fontSize: 14,
    fontWeight: 850,
  },

  newChatSubtitle: {
    color: "#9fb5d1",
    fontSize: 11,
  },

  newChatArrow: {
    color: "#67e8f9",
    fontSize: 24,
    lineHeight: 1,
  },

  searchWrapper: {
    position: "relative",
    marginBottom: 14,
  },

  searchIcon: {
    position: "absolute",
    left: 13,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#7187a4",
    fontSize: 18,
    pointerEvents: "none",
  },

  search: {
    width: "100%",
    height: 43,
    boxSizing: "border-box",
    padding: "0 37px 0 39px",
    borderRadius: 13,
    border: "1px solid rgba(148, 163, 184, 0.16)",
    outline: "none",
    background: "rgba(15, 30, 50, 0.76)",
    color: "#e2e8f0",
    fontSize: 13,
    fontFamily: "inherit",
  },

  clearSearch: {
    position: "absolute",
    right: 9,
    top: "50%",
    transform: "translateY(-50%)",
    width: 26,
    height: 26,
    border: "none",
    borderRadius: 8,
    background: "transparent",
    color: "#8296af",
    cursor: "pointer",
    fontSize: 18,
  },

  navigation: {
    display: "grid",
    gap: 5,
  },

  navButton: {
    position: "relative",
    width: "100%",
    height: 45,
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "0 12px",
    border: "1px solid transparent",
    borderRadius: 13,
    background: "transparent",
    color: "#9fb0c6",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    textAlign: "left",
  },

  navButtonActive: {
    background:
      "linear-gradient(90deg, rgba(34,211,238,0.14), rgba(14,165,233,0.06))",
    border: "1px solid rgba(34, 211, 238, 0.17)",
    color: "#ffffff",
  },

  navIcon: {
    width: 29,
    height: 29,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    background: "rgba(148, 163, 184, 0.07)",
    color: "#8196b0",
    fontSize: 15,
  },

  navIconActive: {
    background: "rgba(34, 211, 238, 0.14)",
    color: "#67e8f9",
  },

  navIndicator: {
    position: "absolute",
    right: 10,
    width: 5,
    height: 5,
    borderRadius: 999,
    background: "#22d3ee",
    boxShadow: "0 0 12px rgba(34, 211, 238, 0.9)",
  },

  divider: {
    height: 1,
    margin: "0 16px",
    background:
      "linear-gradient(90deg, transparent, rgba(148,163,184,0.18), transparent)",
    flexShrink: 0,
  },

  history: {
    flex: 1,
    minHeight: 0,
    padding: "17px 12px 14px",
    overflowY: "auto",
  },

  historyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 8px",
    marginBottom: 9,
  },

  sectionTitle: {
    margin: 0,
    color: "#6f839d",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.13em",
    textTransform: "uppercase",
  },

  conversationCount: {
    minWidth: 22,
    height: 19,
    padding: "0 6px",
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(148, 163, 184, 0.08)",
    color: "#8da2bb",
    fontSize: 10,
    fontWeight: 800,
  },

  conversationList: {
    display: "grid",
    gap: 4,
  },

  conversationButton: {
    position: "relative",
    width: "100%",
    minHeight: 43,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 11px",
    border: "1px solid transparent",
    borderRadius: 12,
    background: "transparent",
    color: "#94a7bf",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },

  conversationButtonActive: {
    background: "rgba(24, 45, 70, 0.9)",
    border: "1px solid rgba(103, 232, 249, 0.12)",
    color: "#f8fafc",
    boxShadow: "0 8px 20px rgba(2, 8, 23, 0.15)",
  },

  conversationIcon: {
    width: 25,
    height: 25,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    background: "rgba(148, 163, 184, 0.06)",
    color: "#6f849e",
    fontSize: 12,
  },

  conversationIconActive: {
    background: "rgba(34, 211, 238, 0.1)",
    color: "#67e8f9",
  },

  conversationTitle: {
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 650,
  },

  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    flexShrink: 0,
    background: "#22d3ee",
    boxShadow: "0 0 9px rgba(34, 211, 238, 0.75)",
  },

  emptyState: {
    margin: "18px 4px",
    padding: "22px 14px",
    borderRadius: 15,
    border: "1px dashed rgba(148, 163, 184, 0.14)",
    background: "rgba(15, 30, 50, 0.32)",
    textAlign: "center",
  },

  emptyIcon: {
    marginBottom: 8,
    color: "#4b617b",
    fontSize: 23,
  },

  emptyTitle: {
    margin: "0 0 5px",
    color: "#b4c2d3",
    fontSize: 12,
    fontWeight: 750,
  },

  emptyText: {
    color: "#71859e",
    fontSize: 11,
    lineHeight: 1.5,
  },

  footer: {
    flexShrink: 0,
    padding: "12px 14px 15px",
    borderTop: "1px solid rgba(148, 163, 184, 0.12)",
    background: "rgba(4, 12, 24, 0.42)",
  },

  profileButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px",
    border: "1px solid transparent",
    borderRadius: 14,
    background: "transparent",
    color: "#ffffff",
    cursor: "pointer",
    textAlign: "left",
  },

  profileButtonActive: {
    border: "1px solid rgba(34, 211, 238, 0.18)",
    background: "rgba(34, 211, 238, 0.08)",
  },

  avatarWrapper: {
    position: "relative",
    width: 39,
    height: 39,
    flexShrink: 0,
  },

  avatar: {
    width: 39,
    height: 39,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "linear-gradient(135deg, #1b3a58, #124b66)",
    border: "1px solid rgba(103, 232, 249, 0.22)",
    color: "#dffaff",
    fontSize: 12,
    fontWeight: 900,
  },

  onlineDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 9,
    height: 9,
    borderRadius: 999,
    background: "#22c55e",
    border: "2px solid #08111f",
  },

  profileInfo: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  profileName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: 800,
  },

  profilePlan: {
    color: "#7f94ad",
    fontSize: 11,
  },

  profileArrow: {
    color: "#61758d",
    fontSize: 21,
  },

  connectionStatus: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 9,
    color: "#60758e",
    fontSize: 10,
    fontWeight: 700,
  },

  connectionDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#22c55e",
    boxShadow: "0 0 7px rgba(34,197,94,0.55)",
  },
};