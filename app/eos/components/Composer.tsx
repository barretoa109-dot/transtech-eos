"use client";

import { useEffect, useRef } from "react";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const puedeEnviar = mensaje.trim().length > 0 && !cargando;

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [mensaje]);

  function manejarEnvio() {
    if (!puedeEnviar) return;
    onEnviar();
  }

  return (
    <div style={styles.dock}>
      <div style={styles.container}>
        <div style={styles.composer}>
          <label
            title="Adjuntar una imagen"
            aria-label="Adjuntar una imagen"
            style={styles.attachButton}
          >
            <span style={styles.attachIcon}>＋</span>

            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file && onImagenSeleccionada) {
                  onImagenSeleccionada(file);
                }

                event.target.value = "";
              }}
            />
          </label>

          <div style={styles.inputArea}>
            <textarea
              ref={textareaRef}
              value={mensaje}
              disabled={cargando}
              onChange={(event) =>
                onMensajeChange(event.target.value)
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  manejarEnvio();
                }
              }}
              placeholder={
                cargando
                  ? "EOS está preparando una respuesta..."
                  : "Escribile algo a EOS..."
              }
              rows={1}
              aria-label="Mensaje para EOS"
              style={{
                ...styles.textarea,
                ...(cargando
                  ? styles.textareaDisabled
                  : {}),
              }}
            />

            <div style={styles.inputFooter}>
              <div style={styles.tools}>
                <span style={styles.toolLabel}>
                  <span style={styles.toolDot} />
                  Memoria activa
                </span>

                <span style={styles.shortcut}>
                  Shift + Enter para nueva línea
                </span>
              </div>

              <span
                style={{
                  ...styles.characterCount,
                  ...(mensaje.length > 3500
                    ? styles.characterCountWarning
                    : {}),
                }}
              >
                {mensaje.length.toLocaleString()}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={manejarEnvio}
            disabled={!puedeEnviar}
            aria-label={
              cargando
                ? "EOS está respondiendo"
                : "Enviar mensaje"
            }
            title={
              cargando
                ? "EOS está respondiendo"
                : "Enviar mensaje"
            }
            style={{
              ...styles.sendButton,
              ...(puedeEnviar
                ? styles.sendButtonActive
                : styles.sendButtonDisabled),
            }}
          >
            {cargando ? (
              <span style={styles.loadingDots}>
                <span style={styles.loadingDot} />
                <span style={styles.loadingDot} />
                <span style={styles.loadingDot} />
              </span>
            ) : (
              <span style={styles.sendIcon}>↑</span>
            )}
          </button>
        </div>

        <p style={styles.note}>
          EOS puede cometer errores. Verificá la información importante antes
          de tomar decisiones.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  dock: {
    position: "fixed",
    left: 280,
    right: 0,
    bottom: 0,
    zIndex: 30,
    padding: "38px 24px 14px",
    background:
      "linear-gradient(180deg, rgba(7,17,31,0) 0%, rgba(7,17,31,0.92) 28%, #07111f 72%)",
    pointerEvents: "none",
    fontFamily: "Inter, Arial, Helvetica, sans-serif",
  },

  container: {
    width: "100%",
    maxWidth: 900,
    margin: "0 auto",
    pointerEvents: "auto",
  },

  composer: {
    position: "relative",
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    padding: 9,
    borderRadius: 24,
    border: "1px solid rgba(103, 232, 249, 0.2)",
    background:
      "linear-gradient(145deg, rgba(17,35,56,0.98), rgba(11,25,42,0.98))",
    boxShadow:
      "0 22px 60px rgba(2,8,23,0.5), inset 0 1px 0 rgba(255,255,255,0.045)",
    backdropFilter: "blur(22px)",
  },

  attachButton: {
    width: 43,
    height: 43,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.13)",
    background: "rgba(148,163,184,0.07)",
    color: "#91a6be",
    cursor: "pointer",
    transition: "all 160ms ease",
  },

  attachIcon: {
    fontSize: 23,
    fontWeight: 500,
    lineHeight: 1,
  },

  inputArea: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },

  textarea: {
    width: "100%",
    minHeight: 44,
    maxHeight: 180,
    boxSizing: "border-box",
    resize: "none",
    overflowY: "auto",
    padding: "11px 8px 6px",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#f8fafc",
    caretColor: "#67e8f9",
    fontFamily: "inherit",
    fontSize: 15,
    lineHeight: 1.55,
  },

  textareaDisabled: {
    color: "#8194aa",
    cursor: "not-allowed",
  },

  inputFooter: {
    minHeight: 21,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "0 8px 3px",
  },

  tools: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 13,
    color: "#61758d",
    fontSize: 9,
    fontWeight: 700,
  },

  toolLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  },

  toolDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: "#22d3ee",
    boxShadow: "0 0 8px rgba(34,211,238,0.65)",
  },

  shortcut: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  characterCount: {
    flexShrink: 0,
    color: "#53677e",
    fontSize: 9,
    fontWeight: 700,
  },

  characterCountWarning: {
    color: "#fbbf24",
  },

  sendButton: {
    width: 45,
    height: 45,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
    border: "none",
    borderRadius: 15,
    fontFamily: "inherit",
    transition: "all 160ms ease",
  },

  sendButtonActive: {
    background:
      "linear-gradient(135deg, #67e8f9 0%, #22d3ee 48%, #0ea5e9 100%)",
    color: "#042f3e",
    cursor: "pointer",
    boxShadow:
      "0 11px 25px rgba(14,165,233,0.3), inset 0 1px 0 rgba(255,255,255,0.4)",
  },

  sendButtonDisabled: {
    background: "rgba(148,163,184,0.1)",
    color: "#52667d",
    cursor: "not-allowed",
    boxShadow: "none",
  },

  sendIcon: {
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 900,
    transform: "translateY(-1px)",
  },

  loadingDots: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },

  loadingDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    background: "currentColor",
  },

  note: {
    margin: "8px 0 0",
    color: "#51657c",
    fontSize: 10,
    lineHeight: 1.4,
    textAlign: "center",
  },
};