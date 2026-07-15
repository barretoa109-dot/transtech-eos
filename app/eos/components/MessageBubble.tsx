"use client";

type MessageBubbleProps = {
  rol: "usuario" | "eos";
  texto: string;
  nombre: string;
};

export default function MessageBubble({ rol, texto, nombre }: MessageBubbleProps) {
  const esUsuario = rol === "usuario";
  const lineas = texto.split("\n");

  return (
    <div style={{ ...styles.row, justifyContent: esUsuario ? "flex-end" : "flex-start" }}>
      {!esUsuario && <div style={styles.avatar}>E</div>}

      <article style={{ ...styles.bubble, ...(esUsuario ? styles.userBubble : styles.eosBubble) }}>
        <div style={styles.meta}>{esUsuario ? nombre : "EOS"}</div>

        <div style={styles.content}>
          {lineas.map((linea, i) => {
            const limpio = linea.trim();

            if (!limpio) return <div key={i} style={{ height: 8 }} />;

            if (
              limpio.startsWith("http://") ||
              limpio.startsWith("https://") ||
              limpio.startsWith("/descargar")
            ) {
              return (
                <a
                  key={i}
                  href={limpio}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.fileCard}
                >
                  <div style={styles.fileIcon}>↓</div>
                  <div>
                    <strong>Descargar archivo</strong>
                    <span>Documento generado por EOS</span>
                  </div>
                </a>
              );
            }

            if (limpio.startsWith("•") || limpio.startsWith("-")) {
              return (
                <div key={i} style={styles.bullet}>
                  <span style={styles.bulletDot} />
                  <span>{limpio.replace(/^[-•]\s*/, "")}</span>
                </div>
              );
            }

            if (/^\d+\./.test(limpio)) {
              return (
                <div key={i} style={styles.numbered}>
                  {limpio}
                </div>
              );
            }

            return <p key={i} style={styles.paragraph}>{linea}</p>;
          })}
        </div>
      </article>

      {esUsuario && <div style={styles.avatarUser}>{nombre.charAt(0).toUpperCase()}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    gap: 12,
    marginBottom: 18,
    alignItems: "flex-start",
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    color: "#06202a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flexShrink: 0,
  },
  avatarUser: {
    width: 34,
    height: 34,
    borderRadius: 999,
    background: "#dff8fc",
    color: "#06202a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flexShrink: 0,
  },
  bubble: {
    maxWidth: 760,
    borderRadius: 20,
    padding: "15px 17px",
    fontSize: 15,
    lineHeight: 1.65,
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  userBubble: {
    background: "#dff8fc",
    color: "#0f172a",
    border: "1px solid #bae6fd",
  },
  eosBubble: {
    background: "#ffffff",
    color: "#0f172a",
    border: "1px solid #e5e7eb",
    boxShadow: "0 12px 30px rgba(15,23,42,.045)",
  },
  meta: {
    fontSize: 12,
    fontWeight: 900,
    color: "#64748b",
    marginBottom: 8,
  },
  content: {
    display: "block",
  },
  paragraph: {
    margin: "0 0 8px",
  },
  bullet: {
    display: "flex",
    gap: 9,
    alignItems: "flex-start",
    margin: "5px 0",
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#22c7df",
    marginTop: 9,
    flexShrink: 0,
  },
  numbered: {
    margin: "6px 0",
    fontWeight: 600,
  },
  fileCard: {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 12,
    border: "1px solid #bae6fd",
    background: "#ecfeff",
    borderRadius: 14,
    padding: 12,
    color: "#075985",
    textDecoration: "none",
  },
  fileIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    background: "#22d3ee",
    color: "#06202a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 20,
  },
};