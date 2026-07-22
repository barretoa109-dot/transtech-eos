"use client";

type MessageBubbleProps = {
  rol: "usuario" | "eos";
  texto: string;
  nombre: string;
};

export default function MessageBubble({
  rol,
  texto,
  nombre,
}: MessageBubbleProps) {
  const esUsuario = rol === "usuario";

  const lineas = texto.split("\n");

  return (
    <div
      style={{
        ...styles.row,
        justifyContent: esUsuario ? "flex-end" : "flex-start",
      }}
    >
      {!esUsuario && (
        <div style={styles.avatarEOS}>
          ✦
        </div>
      )}

      <article
        style={{
          ...styles.bubble,
          ...(esUsuario
            ? styles.userBubble
            : styles.eosBubble),
        }}
      >
        <div style={styles.header}>
          <strong style={styles.author}>
            {esUsuario ? nombre : "EOS"}
          </strong>

          <span style={styles.time}>
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        <div style={styles.content}>
          {lineas.map((linea, i) => {
            const limpio = linea.trim();

            if (!limpio)
              return (
                <div
                  key={i}
                  style={{ height: 10 }}
                />
              );

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
                  <div style={styles.fileIcon}>
                    ↓
                  </div>

                  <div>
                    <strong>
                      Descargar archivo
                    </strong>

                    <div style={styles.fileSub}>
                      Documento generado por EOS
                    </div>
                  </div>
                </a>
              );
            }

            if (
              limpio.startsWith("-") ||
              limpio.startsWith("•")
            ) {
              return (
                <div
                  key={i}
                  style={styles.bullet}
                >
                  <div style={styles.dot} />

                  <span>
                    {limpio.replace(
                      /^[-•]\s*/,
                      ""
                    )}
                  </span>
                </div>
              );
            }

            if (/^\d+\./.test(limpio)) {
              return (
                <div
                  key={i}
                  style={styles.numbered}
                >
                  {limpio}
                </div>
              );
            }

            return (
              <p
                key={i}
                style={styles.paragraph}
              >
                {linea}
              </p>
            );
          })}
        </div>

        {!esUsuario && (
          <div style={styles.footer}>
            <button style={styles.action}>
              Copiar
            </button>

            <button style={styles.action}>
              Regenerar
            </button>
          </div>
        )}
      </article>

      {esUsuario && (
        <div style={styles.avatarUser}>
          {nombre.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    gap: 14,
    marginBottom: 28,
    alignItems: "flex-start",
  },

  avatarEOS: {
    width: 42,
    height: 42,
    borderRadius: 14,
    background:
      "linear-gradient(135deg,#67e8f9,#22d3ee,#0ea5e9)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#042f3e",
    fontWeight: 900,
    fontSize: 18,
    flexShrink: 0,
    boxShadow:
      "0 12px 25px rgba(14,165,233,.25)",
  },

  avatarUser: {
    width: 42,
    height: 42,
    borderRadius: 999,
    background: "#1e3a5f",
    border: "1px solid #2b527f",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flexShrink: 0,
  },

  bubble: {
    maxWidth: 760,
    borderRadius: 22,
    padding: "18px 20px",
    fontFamily: "Inter, Arial",
    fontSize: 15,
    lineHeight: 1.75,
  },

  eosBubble: {
    background: "#132238",
    border: "1px solid #1f3859",
    color: "#f8fafc",
    boxShadow:
      "0 18px 35px rgba(0,0,0,.15)",
  },

  userBubble: {
    background:
      "linear-gradient(135deg,#0ea5e9,#0284c7)",
    color: "#ffffff",
    border: "1px solid #38bdf8",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  author: {
    color: "#ffffff",
    fontSize: 13,
  },

  time: {
    color: "#7f95b0",
    fontSize: 11,
  },

  content: {},

  paragraph: {
    margin: "0 0 10px",
  },

  bullet: {
    display: "flex",
    gap: 10,
    margin: "8px 0",
    alignItems: "flex-start",
  },

  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#22d3ee",
    marginTop: 9,
    flexShrink: 0,
  },

  numbered: {
    margin: "8px 0",
    fontWeight: 600,
  },

  fileCard: {
    marginTop: 12,
    display: "flex",
    gap: 14,
    alignItems: "center",
    padding: 15,
    borderRadius: 16,
    background: "#0f1c2e",
    border: "1px solid #21476c",
    color: "#ffffff",
    textDecoration: "none",
  },

  fileIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: "#22d3ee",
    color: "#083344",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 18,
  },

  fileSub: {
    color: "#7d96b1",
    fontSize: 12,
    marginTop: 4,
  },

  footer: {
    display: "flex",
    gap: 10,
    marginTop: 18,
    paddingTop: 14,
    borderTop: "1px solid #233d5d",
  },

  action: {
    border: "none",
    background: "#1a304d",
    color: "#9ec8ff",
    padding: "8px 14px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  },
};