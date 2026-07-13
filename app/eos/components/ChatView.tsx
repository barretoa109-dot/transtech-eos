"use client";

import MessageBubble from "./MessageBubble";
import type { Mensaje } from "../types/chat";

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
    {
      titulo: "Ordenar mis finanzas",
      texto: "Quiero ordenar mis finanzas personales",
    },
    {
      titulo: "Crear plan de negocio",
      texto: "Quiero crear un plan para mi negocio",
    },
    {
      titulo: "Generar documento",
      texto: "Quiero generar un documento profesional",
    },
    {
      titulo: "Organizar objetivos",
      texto: "Quiero organizar mis objetivos y tareas",
    },
  ];

  const estaVacio = historial.length === 0;

  return (
    <div ref={chatRef} style={styles.chatArea}>
      <div style={styles.chatInner}>
        {estaVacio && (
          <section style={styles.welcome}>
            <div style={styles.logo}>E</div>

            <h1 style={styles.title}>¿Qué querés resolver hoy?</h1>

            <p style={styles.subtitle}>
              EOS puede ayudarte con finanzas, negocios, documentos, objetivos,
              imágenes, archivos y decisiones importantes.
            </p>

            <div style={styles.quickGrid}>
              {sugerencias.map((item) => (
                <button
                  key={item.titulo}
                  onClick={() => onEnviarSugerencia(item.texto)}
                  style={styles.quickCard}
                >
                  <strong>{item.titulo}</strong>
                  <span>Empezar con EOS</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!estaVacio && (
          <section style={styles.messages}>
            {historial.map((item, index) => {
  const mensaje = item as Mensaje & {
    archivo_url?: string;
    archivo_tipo?: string;
    tipo?: string;
    accion?: string;
  };

  return (
    <div key={index}>
      <MessageBubble
        rol={mensaje.rol}
        texto={mensaje.texto}
        nombre={nombre}
      />

      {mensaje.rol === "eos" && mensaje.archivo_url && (
        <div style={styles.fileRow}>
          <a
            href={mensaje.archivo_url}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.downloadButton}
          >
            <span style={styles.downloadIcon}>↓</span>

            <span>
              Descargar{" "}
              {mensaje.archivo_tipo === "excel"
                ? "Excel"
                : mensaje.archivo_tipo === "pdf"
                  ? "PDF"
                  : mensaje.archivo_tipo === "word"
                    ? "Word"
                    : "archivo"}
            </span>
          </a>
        </div>
      )}
    </div>
  );
})}
          </section>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "30px 24px 135px",
    background: "#ffffff",
  },
  chatInner: {
    maxWidth: 880,
    margin: "0 auto",
  },
  welcome: {
    minHeight: "68vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  },
  logo: {
    width: 62,
    height: 62,
    borderRadius: 20,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    color: "#06202a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 30,
    fontWeight: 900,
    marginBottom: 22,
    boxShadow: "0 16px 35px rgba(34,211,238,.28)",
  },
  title: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1.15,
    letterSpacing: "-0.04em",
    color: "#0f172a",
    fontWeight: 800,
  },
  subtitle: {
    maxWidth: 620,
    marginTop: 14,
    color: "#475569",
    fontSize: 16,
    lineHeight: 1.65,
  },
  quickGrid: {
    width: "100%",
    maxWidth: 760,
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginTop: 30,
  },
  quickCard: {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 18,
    padding: "18px 20px",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "Arial, Helvetica, sans-serif",
    display: "flex",
    flexDirection: "column",
    gap: 7,
    boxShadow: "0 10px 28px rgba(15,23,42,.04)",
  },
  messages: {
    paddingTop: 8,
  },
  
   fileRow: {
    display: "flex",
    marginTop: -8,
    marginBottom: 18,
    paddingLeft: 64,
  },

  downloadButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 16px",
    borderRadius: 12,
    background: "#06b6d4",
    color: "#ffffff",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 800,
    boxShadow: "0 8px 20px rgba(6,182,212,0.22)",
    cursor: "pointer",
  },

  downloadIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    background: "rgba(255,255,255,0.2)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 17,
    fontWeight: 900,
  },
};