"use client";

type MessageBubbleProps = {
  rol: "usuario" | "eos";
  texto: string;
  nombre: string;
};

export default function MessageBubble({ rol, texto, nombre }: MessageBubbleProps) {
  const esUsuario = rol === "usuario";

  return (
    <div style={{ ...styles.row, justifyContent: esUsuario ? "flex-end" : "flex-start" }}>
      {!esUsuario && <div style={styles.avatar}>E</div>}

      <div style={{ ...styles.bubble, ...(esUsuario ? styles.userBubble : styles.eosBubble) }}>
        <div style={styles.meta}>{esUsuario ? nombre : "EOS"}</div>

        {texto.split("\n").map((linea, i) => {
          const textoLimpio = linea.trim();

          if (
            textoLimpio.startsWith("http://") ||
            textoLimpio.startsWith("https://") ||
            textoLimpio.startsWith("/descargar")
          ) {
            return (
              <div key={i} style={{ marginTop: 10 }}>
                <a
                  href={textoLimpio}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  📥 Descargar archivo
                </a>
              </div>
            );
          }

          return <div key={i}>{linea}</div>;
        })}
      </div>

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
    background: "#22c7df",
    color: "#06121f",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flexShrink: 0,
  },
  avatarUser: {
    width: 34,
    height: 34,
    borderRadius: 12,
    background: "#dff8fc",
    color: "#06121f",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flexShrink: 0,
  },
  bubble: {
    maxWidth: 720,
    borderRadius: 18,
    padding: "14px 16px",
    fontSize: 15,
    lineHeight: 1.65,
    fontFamily: "Arial, sans-serif",
    border: "1px solid #e5e7eb",
  },
  userBubble: {
    background: "#dff8fc",
    color: "#0f172a",
  },
  eosBubble: {
    background: "#ffffff",
    color: "#0f172a",
  },
  meta: {
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    marginBottom: 6,
  },
  link: {
    color: "#0891b2",
    fontWeight: 800,
    textDecoration: "underline",
  },
};