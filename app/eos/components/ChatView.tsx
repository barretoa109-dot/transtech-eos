"use client";

import MessageBubble from "./MessageBubble";

type Mensaje = {
  rol: "usuario" | "eos";
  texto: string;
};

type ChatViewProps = {
  historial: Mensaje[];
  nombre: string;
  chatRef: React.RefObject<HTMLDivElement | null>;
  onEnviarSugerencia: (texto: string) => void;
};

export default function ChatView({
  historial,
  nombre,
  chatRef,
  onEnviarSugerencia,
}: ChatViewProps) {
  const sugerencias = [
    "Ordenar mis finanzas",
    "Crear un plan para mi negocio",
    "Generar un Excel profesional",
    "Organizar mis objetivos",
  ];

  return (
    <div ref={chatRef} style={styles.chatArea}>
      <div style={styles.chatInner}>
        {historial.length === 0 && (
          <div style={styles.welcome}>
            <div style={styles.eosOrb}>E</div>
            <h2 style={styles.title}>¿Qué querés trabajar hoy?</h2>
            <p style={styles.subtitle}>
              EOS puede ayudarte con tu vida personal, negocio, documentos,
              finanzas, objetivos y decisiones.
            </p>

            <div style={styles.quickGrid}>
              {sugerencias.map((accion) => (
                <button
                  key={accion}
                  onClick={() => onEnviarSugerencia(accion)}
                  style={styles.quickAction}
                >
                  {accion}
                </button>
              ))}
            </div>
          </div>
        )}

        {historial.map((item, index) => (
          <MessageBubble
            key={index}
            rol={item.rol}
            texto={item.texto}
            nombre={nombre}
          />
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "28px 24px 130px",
  },
  chatInner: {
    maxWidth: 850,
    margin: "0 auto",
  },
  welcome: {
    minHeight: "65vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  },
  eosOrb: {
    width: 64,
    height: 64,
    borderRadius: 20,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 30,
    fontWeight: 900,
    marginBottom: 20,
    color: "#06202a",
  },
  title: {
    margin: 0,
    fontSize: 30,
    fontWeight: 800,
  },
  subtitle: {
    maxWidth: 560,
    color: "#64748b",
    lineHeight: 1.65,
    marginTop: 12,
  },
  quickGrid: {
    marginTop: 24,
    width: "100%",
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  },
  quickAction: {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 14,
    padding: 16,
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
    fontFamily: "Arial, Helvetica, sans-serif",
  },
};