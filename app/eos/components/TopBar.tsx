"use client";

export default function TopBar() {
  return (
    <header style={styles.topbar}>
      <div style={styles.left}>
        <div style={styles.logo}>
          <span>✦</span>
        </div>

        <div>
          <h2 style={styles.title}>EOS</h2>
          <p style={styles.subtitle}>
            Asistente Inteligente de TransTech
          </p>
        </div>
      </div>

      <div style={styles.right}>
        <div style={styles.status}>
          <span style={styles.dot} />
          Conectado
        </div>

        <div style={styles.badge}>
          Memoria activa
        </div>

        <div style={styles.badge}>
          GPT
        </div>
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: {
    height: 72,
    padding: "0 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#ffffff",
    borderBottom: "1px solid #e5e7eb",
    flexShrink: 0,
    fontFamily: "Inter, Arial, Helvetica, sans-serif",
  },

  left: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },

  logo: {
    width: 46,
    height: 46,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "linear-gradient(135deg,#22d3ee,#0ea5e9)",
    color: "#042f3e",
    fontWeight: 900,
    fontSize: 20,
    boxShadow: "0 10px 25px rgba(14,165,233,.25)",
  },

  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 900,
    color: "#0f172a",
  },

  subtitle: {
    margin: "2px 0 0",
    color: "#64748b",
    fontSize: 13,
  },

  right: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },

  status: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 999,
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#15803d",
    fontWeight: 700,
    fontSize: 13,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#22c55e",
    boxShadow: "0 0 8px rgba(34,197,94,.6)",
  },

  badge: {
    padding: "10px 14px",
    borderRadius: 999,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
    fontWeight: 700,
    fontSize: 13,
  },
};