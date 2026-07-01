"use client";

export default function TopBar() {
  return (
    <header style={styles.topbar}>
      <div />
      <div style={styles.status}>
        <span style={styles.dot} />
        Activo
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: {
    height: 54,
    borderBottom: "1px solid #eeeeee",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 28px",
    flexShrink: 0,
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#15803d",
    borderRadius: 999,
    padding: "8px 13px",
    fontWeight: 700,
    fontSize: 14,
  },
  dot: {
    width: 8,
    height: 8,
    background: "#22c55e",
    borderRadius: 999,
  },
};