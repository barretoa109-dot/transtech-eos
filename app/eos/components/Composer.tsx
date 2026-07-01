"use client";

type ComposerProps = {
  mensaje: string;
  cargando: boolean;
  onMensajeChange: (value: string) => void;
  onEnviar: () => void;
  onImagenSeleccionada?: (file: File) => void;
};

export default function Composer({
  mensaje,
  cargando,
  onMensajeChange,
  onEnviar,
  onImagenSeleccionada,
}: ComposerProps) {
  return (
    <div style={styles.dock}>
      <div style={styles.box}>
        <label style={styles.plusButton}>
          +
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onImagenSeleccionada) onImagenSeleccionada(file);
              e.target.value = "";
            }}
          />
        </label>

        <textarea
          value={mensaje}
          onChange={(e) => onMensajeChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onEnviar();
            }
          }}
          placeholder="Preguntale algo a EOS..."
          rows={1}
          style={styles.textarea}
        />

        <button onClick={onEnviar} disabled={cargando} style={styles.send}>
          {cargando ? "..." : "↑"}
        </button>
      </div>

      <p style={styles.note}>EOS puede cometer errores. Usalo como apoyo para decidir mejor.</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  dock: {
    position: "fixed",
    left: 280,
    right: 0,
    bottom: 0,
    background: "linear-gradient(to top,#ffffff 78%,rgba(255,255,255,0))",
    padding: "28px 24px 14px",
  },
  box: {
    maxWidth: 850,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: 999,
    padding: 8,
    boxShadow: "0 12px 35px rgba(0,0,0,.08)",
  },
  plusButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: "none",
    background: "#f3f4f6",
    cursor: "pointer",
    fontSize: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    padding: "11px 6px",
    fontSize: 15,
    fontFamily: "Arial, Helvetica, sans-serif",
    minHeight: 42,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 999,
    border: "none",
    background: "#22d3ee",
    color: "#083344",
    fontWeight: 900,
    fontSize: 19,
    cursor: "pointer",
  },
  note: {
    textAlign: "center",
    color: "#6b7280",
    fontSize: 12,
    margin: "8px 0 0",
  },
};