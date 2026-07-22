"use client";

import MessageBubble from "./MessageBubble";
import type { Mensaje } from "../types/chat";

type ChatViewProps = {
  historial: Mensaje[];
  nombre: string;
  chatRef: React.RefObject<HTMLDivElement | null>;
  onEnviarSugerencia: (texto: string) => void;
};

type Sugerencia = {
  icono: string;
  titulo: string;
  descripcion: string;
  texto: string;
};

export default function ChatView({
  historial,
  nombre,
  chatRef,
  onEnviarSugerencia,
}: ChatViewProps) {
  const primerNombre =
    nombre?.trim().split(/\s+/)[0] || "Usuario";

  const sugerencias: Sugerencia[] = [
    {
      icono: "↗",
      titulo: "Analizar mi negocio",
      descripcion: "Detectar oportunidades, problemas y próximos pasos.",
      texto:
        "Quiero analizar mi negocio. Ayudame a identificar oportunidades, problemas y próximos pasos.",
    },
    {
      icono: "$",
      titulo: "Organizar mis finanzas",
      descripcion: "Crear presupuestos, controles y planes financieros.",
      texto:
        "Quiero ordenar mis finanzas y crear un plan financiero claro.",
    },
    {
      icono: "▤",
      titulo: "Crear un documento",
      descripcion: "Preparar informes, propuestas, Excel, PDF o Word.",
      texto:
        "Quiero crear un documento profesional. Ayudame a definirlo.",
    },
    {
      icono: "✓",
      titulo: "Organizar objetivos",
      descripcion: "Convertir ideas en metas y tareas ejecutables.",
      texto:
        "Quiero organizar mis objetivos y transformarlos en un plan de acción.",
    },
    {
      icono: "⚙",
      titulo: "Automatizar una tarea",
      descripcion: "Diseñar procesos para ahorrar tiempo y trabajo manual.",
      texto:
        "Quiero automatizar una tarea o proceso de mi negocio.",
    },
    {
      icono: "◇",
      titulo: "Consultar mi memoria",
      descripcion: "Revisar qué información y contexto recuerda EOS.",
      texto:
        "Decime qué información recordás actualmente sobre mí y mis proyectos.",
    },
  ];

  const estaVacio = historial.length === 0;

  return (
    <div ref={chatRef} style={styles.chatArea}>
      <div style={styles.backgroundGlowOne} />
      <div style={styles.backgroundGlowTwo} />

      <div style={styles.chatInner}>
        {estaVacio ? (
          <section style={styles.welcome}>
            <div style={styles.statusBadge}>
              <span style={styles.statusDot} />
              EOS está listo
            </div>

            <div style={styles.logoWrapper}>
              <div style={styles.logoGlow} />
              <div style={styles.logo}>✦</div>
            </div>

            <p style={styles.eyebrow}>TRANSTECH EOS</p>

            <h1 style={styles.title}>
              Hola, {primerNombre}.
              <br />
              <span style={styles.titleAccent}>
                ¿Qué vamos a resolver hoy?
              </span>
            </h1>

            <p style={styles.subtitle}>
              Puedo ayudarte a organizar, analizar, crear documentos,
              automatizar procesos y convertir tus ideas en planes concretos.
            </p>

            <div style={styles.quickGrid}>
              {sugerencias.map((item) => (
                <button
                  type="button"
                  key={item.titulo}
                  onClick={() =>
                    onEnviarSugerencia(item.texto)
                  }
                  style={styles.quickCard}
                >
                  <div style={styles.quickCardTop}>
                    <span style={styles.quickIcon}>
                      {item.icono}
                    </span>

                    <span style={styles.quickArrow}>↗</span>
                  </div>

                  <strong style={styles.quickTitle}>
                    {item.titulo}
                  </strong>

                  <span style={styles.quickDescription}>
                    {item.descripcion}
                  </span>
                </button>
              ))}
            </div>

            <div style={styles.capabilities}>
              <span style={styles.capability}>
                <span style={styles.capabilityDot} />
                Memoria contextual
              </span>

              <span style={styles.capability}>
                <span style={styles.capabilityDot} />
                Archivos profesionales
              </span>

              <span style={styles.capability}>
                <span style={styles.capabilityDot} />
                Seguimiento inteligente
              </span>
            </div>
          </section>
        ) : (
          <section style={styles.messages}>
            <div style={styles.conversationHeader}>
              <div>
                <p style={styles.conversationEyebrow}>
                  CONVERSACIÓN ACTIVA
                </p>

                <h2 style={styles.conversationTitle}>
                  Trabajando con EOS
                </h2>
              </div>

              <div style={styles.conversationStatus}>
                <span style={styles.statusDot} />
                Sincronizado
              </div>
            </div>

            <div style={styles.messageList}>
              {historial.map((item, index) => {
                const mensaje = item as Mensaje & {
                  archivo_url?: string;
                  archivo_tipo?: string;
                  tipo?: string;
                  accion?: string;
                };

                return (
                  <div
                    key={`${mensaje.rol}-${index}`}
                    style={styles.messageBlock}
                  >
                    <MessageBubble
                      rol={mensaje.rol}
                      texto={mensaje.texto}
                      nombre={nombre}
                    />

                    {mensaje.rol === "eos" &&
                      mensaje.archivo_url && (
                        <div style={styles.fileRow}>
                          <a
                            href={mensaje.archivo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={styles.downloadButton}
                          >
                            <div style={styles.downloadIcon}>
                              ↓
                            </div>

                            <div style={styles.downloadInfo}>
                              <strong style={styles.downloadTitle}>
                                Descargar{" "}
                                {obtenerNombreTipoArchivo(
                                  mensaje.archivo_tipo
                                )}
                              </strong>

                              <span style={styles.downloadSubtitle}>
                                Archivo generado por EOS
                              </span>
                            </div>

                            <span style={styles.downloadArrow}>
                              ↗
                            </span>
                          </a>
                        </div>
                      )}
                  </div>
                );
              })}
            </div>

            <div style={styles.endMarker}>
              <span style={styles.endLine} />
              <span>EOS mantiene el contexto de esta conversación</span>
              <span style={styles.endLine} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function obtenerNombreTipoArchivo(tipo?: string) {
  switch (tipo?.toLowerCase()) {
    case "excel":
    case "xlsx":
      return "Excel";

    case "pdf":
      return "PDF";

    case "word":
    case "docx":
      return "Word";

    case "imagen":
    case "image":
    case "png":
    case "jpg":
      return "imagen";

    default:
      return "archivo";
  }
}

const styles: Record<string, React.CSSProperties> = {
  chatArea: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "30px 24px 150px",
    background:
      "linear-gradient(180deg, #07101d 0%, #091524 48%, #07111f 100%)",
    color: "#f8fafc",
    fontFamily: "Inter, Arial, Helvetica, sans-serif",
  },

  backgroundGlowOne: {
    position: "fixed",
    top: 80,
    right: "8%",
    width: 420,
    height: 420,
    borderRadius: 999,
    background: "rgba(14, 165, 233, 0.09)",
    filter: "blur(110px)",
    pointerEvents: "none",
  },

  backgroundGlowTwo: {
    position: "fixed",
    bottom: 80,
    left: "30%",
    width: 340,
    height: 340,
    borderRadius: 999,
    background: "rgba(34, 211, 238, 0.055)",
    filter: "blur(100px)",
    pointerEvents: "none",
  },

  chatInner: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: 940,
    margin: "0 auto",
  },

  welcome: {
    minHeight: "calc(100vh - 250px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "35px 0",
  },

  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
    padding: "8px 13px",
    borderRadius: 999,
    border: "1px solid rgba(34, 197, 94, 0.2)",
    background: "rgba(34, 197, 94, 0.07)",
    color: "#86efac",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.03em",
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: "#22c55e",
    boxShadow: "0 0 10px rgba(34, 197, 94, 0.8)",
    flexShrink: 0,
  },

  logoWrapper: {
    position: "relative",
    width: 72,
    height: 72,
    marginBottom: 22,
  },

  logoGlow: {
    position: "absolute",
    inset: -8,
    borderRadius: 26,
    background:
      "linear-gradient(135deg, #22d3ee, #0ea5e9)",
    opacity: 0.35,
    filter: "blur(20px)",
  },

  logo: {
    position: "relative",
    width: 72,
    height: 72,
    borderRadius: 23,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "linear-gradient(135deg, #67e8f9 0%, #22d3ee 45%, #0ea5e9 100%)",
    color: "#042f3e",
    fontSize: 31,
    fontWeight: 950,
    boxShadow:
      "0 18px 44px rgba(14, 165, 233, 0.24)",
  },

  eyebrow: {
    margin: "0 0 10px",
    color: "#67e8f9",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.2em",
  },

  title: {
    margin: 0,
    maxWidth: 760,
    color: "#f8fafc",
    fontSize: "clamp(34px, 5vw, 52px)",
    lineHeight: 1.08,
    fontWeight: 900,
    letterSpacing: "-0.05em",
  },

  titleAccent: {
    background:
      "linear-gradient(90deg, #67e8f9, #38bdf8)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },

  subtitle: {
    maxWidth: 650,
    margin: "20px auto 0",
    color: "#96a9c0",
    fontSize: 16,
    lineHeight: 1.7,
  },

  quickGrid: {
    width: "100%",
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(230px, 1fr))",
    gap: 12,
    marginTop: 38,
    textAlign: "left",
  },

  quickCard: {
    minHeight: 152,
    display: "flex",
    flexDirection: "column",
    padding: 17,
    borderRadius: 18,
    border: "1px solid rgba(148, 163, 184, 0.14)",
    background:
      "linear-gradient(145deg, rgba(18, 36, 57, 0.92), rgba(12, 27, 45, 0.82))",
    color: "#f8fafc",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    boxShadow:
      "0 16px 35px rgba(2, 8, 23, 0.16), inset 0 1px 0 rgba(255,255,255,0.03)",
  },

  quickCardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },

  quickIcon: {
    width: 37,
    height: 37,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    background: "rgba(34, 211, 238, 0.1)",
    border: "1px solid rgba(34, 211, 238, 0.14)",
    color: "#67e8f9",
    fontSize: 17,
    fontWeight: 900,
  },

  quickArrow: {
    color: "#536a84",
    fontSize: 16,
  },

  quickTitle: {
    marginBottom: 7,
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: 850,
  },

  quickDescription: {
    color: "#8296ae",
    fontSize: 12,
    lineHeight: 1.55,
  },

  capabilities: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px 22px",
    marginTop: 27,
    color: "#6f849d",
    fontSize: 11,
    fontWeight: 700,
  },

  capability: {
    display: "flex",
    alignItems: "center",
    gap: 7,
  },

  capabilityDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: "#22d3ee",
    boxShadow: "0 0 8px rgba(34, 211, 238, 0.6)",
  },

  messages: {
    width: "100%",
    paddingTop: 4,
  },

  conversationHeader: {
    minHeight: 75,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    marginBottom: 28,
    padding: "15px 18px",
    borderRadius: 17,
    border: "1px solid rgba(148, 163, 184, 0.12)",
    background: "rgba(12, 27, 45, 0.58)",
    backdropFilter: "blur(12px)",
  },

  conversationEyebrow: {
    margin: "0 0 5px",
    color: "#4f8da3",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.15em",
  },

  conversationTitle: {
    margin: 0,
    color: "#eaf8ff",
    fontSize: 18,
    fontWeight: 850,
    letterSpacing: "-0.02em",
  },

  conversationStatus: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 11px",
    borderRadius: 999,
    border: "1px solid rgba(34, 197, 94, 0.17)",
    background: "rgba(34, 197, 94, 0.06)",
    color: "#86efac",
    fontSize: 10,
    fontWeight: 800,
  },

  messageList: {
    display: "flex",
    flexDirection: "column",
  },

  messageBlock: {
    width: "100%",
  },

  fileRow: {
    display: "flex",
    marginTop: -7,
    marginBottom: 23,
    paddingLeft: 54,
  },

  downloadButton: {
    width: "min(100%, 420px)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 15px",
    borderRadius: 15,
    border: "1px solid rgba(34, 211, 238, 0.18)",
    background:
      "linear-gradient(135deg, rgba(8, 145, 178, 0.16), rgba(14, 116, 144, 0.08))",
    color: "#e6fbff",
    textDecoration: "none",
    boxShadow: "0 12px 25px rgba(2, 8, 23, 0.14)",
  },

  downloadIcon: {
    width: 39,
    height: 39,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    background:
      "linear-gradient(135deg, #67e8f9, #22d3ee)",
    color: "#083344",
    fontSize: 19,
    fontWeight: 900,
  },

  downloadInfo: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  downloadTitle: {
    color: "#e6fbff",
    fontSize: 13,
    fontWeight: 850,
  },

  downloadSubtitle: {
    color: "#7291a7",
    fontSize: 10,
  },

  downloadArrow: {
    color: "#67e8f9",
    fontSize: 15,
  },

  endMarker: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 28,
    color: "#52677f",
    fontSize: 10,
    textAlign: "center",
  },

  endLine: {
    height: 1,
    flex: 1,
    background:
      "linear-gradient(90deg, transparent, rgba(148,163,184,0.14))",
  },
};