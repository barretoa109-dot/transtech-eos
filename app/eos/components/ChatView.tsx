"use client";

import Image from "next/image";
import {
  ArrowUpRight,
  BarChart3,
  FileSpreadsheet,
  Landmark,
  Sparkles,
  Target,
} from "lucide-react";

import MessageBubble from "./MessageBubble";
import type { Mensaje } from "../types/chat";

type ChatViewProps = {
  historial: Mensaje[];
  nombre: string;
  chatRef: React.RefObject<HTMLDivElement | null>;
  onEnviarSugerencia: (texto: string) => void;
};

type MensajeExtendido = Mensaje & {
  archivo_url?: string;
  archivo_tipo?: string;
  tipo?: string;
  accion?: string;
};

const sugerencias = [
  {
    titulo: "Analizar mi negocio",
    descripcion:
      "Detectar oportunidades, riesgos, problemas y próximos pasos.",
    texto:
      "Quiero analizar mi negocio y detectar oportunidades, problemas y próximos pasos.",
    icono: BarChart3,
  },
  {
    titulo: "Organizar mis finanzas",
    descripcion:
      "Crear presupuestos, controles, proyecciones y planes financieros.",
    texto:
      "Quiero organizar mis finanzas y crear un plan financiero claro.",
    icono: Landmark,
  },
  {
    titulo: "Crear un documento",
    descripcion:
      "Preparar Excel, informes, propuestas, presupuestos o reportes.",
    texto:
      "Quiero crear un documento profesional con EOS.",
    icono: FileSpreadsheet,
  },
  {
    titulo: "Organizar mis objetivos",
    descripcion:
      "Convertir una meta en tareas, prioridades y seguimiento.",
    texto:
      "Quiero organizar mis objetivos y convertirlos en un plan de acción.",
    icono: Target,
  },
];

function obtenerPrimerNombre(nombre: string) {
  const limpio = nombre.trim();

  if (!limpio) return "Usuario";

  return limpio.split(/\s+/)[0];
}

function obtenerNombreArchivo(tipo?: string) {
  switch (tipo?.toLowerCase()) {
    case "excel":
    case "xlsx":
      return "Descargar Excel";

    case "pdf":
      return "Descargar PDF";

    case "word":
    case "docx":
      return "Descargar Word";

    case "csv":
      return "Descargar CSV";

    default:
      return "Descargar archivo";
  }
}

export default function ChatView({
  historial,
  nombre,
  chatRef,
  onEnviarSugerencia,
}: ChatViewProps) {
  const estaVacio = historial.length === 0;
  const primerNombre = obtenerPrimerNombre(nombre);

  return (
    <div ref={chatRef} className="eos-chat-scroll">
      <div className="eos-chat-background">
        <div className="eos-grid-pattern" />
        <div className="eos-light eos-light-one" />
        <div className="eos-light eos-light-two" />
      </div>

      <div className="eos-chat-inner">
        {estaVacio ? (
          <section className="eos-welcome">
            <div className="eos-ready">
              <span className="eos-ready-dot" />
              EOS está preparado
            </div>

            <div className="eos-symbol">
  <Image
    src="/transtech-logo.png"
    alt="Logo de TRANSTECH"
    width={44}
    height={44}
    priority
    className="eos-symbol-logo"
  />
</div>

            <p className="eos-brand-label">TRANSTECH EOS</p>

            <h1 className="eos-welcome-title">
              Hola, {primerNombre}.
              <span> ¿Qué vamos a resolver hoy?</span>
            </h1>

            <p className="eos-welcome-description">
              Analizá información, organizá objetivos, generá documentos y
              convertí tus ideas en planes concretos desde una sola
              conversación.
            </p>

            <div className="eos-suggestion-grid">
              {sugerencias.map((item) => {
                const Icono = item.icono;

                return (
                  <button
                    key={item.titulo}
                    type="button"
                    className="eos-suggestion-card"
                    onClick={() => onEnviarSugerencia(item.texto)}
                  >
                    <div className="eos-suggestion-top">
                      <span className="eos-suggestion-icon">
                        <Icono size={20} strokeWidth={2.2} />
                      </span>

                      <ArrowUpRight
                        size={17}
                        className="eos-suggestion-arrow"
                      />
                    </div>

                    <strong>{item.titulo}</strong>

                    <span>{item.descripcion}</span>
                  </button>
                );
              })}
            </div>

            <div className="eos-capabilities">
              <span>
                <span className="eos-capability-dot" />
                Memoria conectada
              </span>

              <span>
                <span className="eos-capability-dot" />
                Documentos y archivos
              </span>

              <span>
                <span className="eos-capability-dot" />
                Seguimiento activo
              </span>
            </div>
          </section>
        ) : (
          <section className="eos-messages">
            <div className="eos-conversation-header">
              <div>
                <p>CONVERSACIÓN CON EOS</p>
                <h2>Espacio de trabajo</h2>
              </div>

              <span>
                <span className="eos-conversation-dot" />
                Memoria activa
              </span>
            </div>

            {historial.map((item, index) => {
              const mensaje = item as MensajeExtendido;

              return (
                <div key={`${mensaje.rol}-${index}`}>
                  <MessageBubble
                    rol={mensaje.rol}
                    texto={mensaje.texto}
                    nombre={nombre}
                  />

                  {mensaje.rol === "eos" && mensaje.archivo_url ? (
                    <div className="eos-file-row">
                      <a
                        href={mensaje.archivo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="eos-generated-file"
                      >
                        <span className="eos-generated-file-icon">
                          <FileSpreadsheet size={21} />
                        </span>

                        <span className="eos-generated-file-info">
                          <strong>
                            {obtenerNombreArchivo(
                              mensaje.archivo_tipo,
                            )}
                          </strong>

                          <small>
                            Documento generado por TransTech EOS
                          </small>
                        </span>

                        <ArrowUpRight size={18} />
                      </a>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        )}
      </div>

      <style jsx>{`
        .eos-chat-scroll {
  position: relative;
  flex: 1;
  min-height: 0;

  overflow-x: hidden;
  overflow-y: auto;

  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;

  background: #f7faff;
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 116, 139, 0.32) transparent;
}

        .eos-chat-scroll::-webkit-scrollbar {
          width: 7px;
        }

        .eos-chat-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .eos-chat-scroll::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(100, 116, 139, 0.28);
        }

        .eos-chat-background {
          position: fixed;
          top: 72px;
          right: 0;
          bottom: 0;
          left: 280px;
          overflow: hidden;
          pointer-events: none;
        }

        .eos-grid-pattern {
          position: absolute;
          inset: 0;
          opacity: 0.42;
          background-image:
            linear-gradient(
              rgba(15, 23, 42, 0.035) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              rgba(15, 23, 42, 0.035) 1px,
              transparent 1px
            );
          background-size: 46px 46px;
          mask-image: linear-gradient(
            to bottom,
            black,
            transparent 92%
          );
        }

        .eos-light {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
        }

        .eos-light-one {
          top: -260px;
          right: -210px;
          width: 620px;
          height: 620px;
          background: rgba(37, 99, 235, 0.13);
        }

        .eos-light-two {
          bottom: -330px;
          left: 8%;
          width: 700px;
          height: 700px;
          background: rgba(96, 165, 250, 0.11);
        }

        .eos-chat-inner {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1040px;
          min-height: 100%;
          margin: 0 auto;
          padding: 34px 34px 160px;
          box-sizing: border-box;
        }

        .eos-welcome {
          min-height: calc(100vh - 248px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .eos-ready {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 32px;
          padding: 0 13px;
          border: 1px solid rgba(34, 197, 94, 0.2);
          border-radius: 999px;
          background: rgba(240, 253, 244, 0.9);
          color: #15803d;
          font-size: 11px;
          font-weight: 800;
          box-shadow: 0 8px 25px rgba(15, 23, 42, 0.04);
        }

        .eos-ready-dot,
        .eos-conversation-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 11px rgba(34, 197, 94, 0.65);
        }

        .eos-symbol {
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  margin-top: 20px;
  padding: 13px;
  border: 1px solid rgba(37, 99, 235, 0.14);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 20px 48px rgba(37, 99, 235, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.eos-symbol-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

        .eos-brand-label {
          margin: 17px 0 0;
          color: #2563eb;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.18em;
        }

        .eos-welcome-title {
          max-width: 900px;
          margin: 14px 0 0;
          color: #071226;
          font-size: clamp(38px, 4.6vw, 62px);
          font-weight: 900;
          line-height: 1.02;
          letter-spacing: -0.055em;
        }

        .eos-welcome-title span {
          color: #2563eb;
        }

        .eos-welcome-description {
          max-width: 700px;
          margin: 19px 0 0;
          color: #64748b;
          font-size: 15px;
          line-height: 1.75;
        }

        .eos-suggestion-grid {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 13px;
          margin-top: 31px;
        }

        .eos-suggestion-card {
          min-width: 0;
          min-height: 164px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 18px;
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.9);
          color: #071226;
          text-align: left;
          cursor: pointer;
          box-shadow:
            0 10px 35px rgba(15, 23, 42, 0.045),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .eos-suggestion-card:hover {
          transform: translateY(-4px);
          border-color: rgba(37, 99, 235, 0.32);
          box-shadow: 0 18px 44px rgba(37, 99, 235, 0.1);
        }

        .eos-suggestion-top {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .eos-suggestion-icon {
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #eff6ff;
          color: #2563eb;
        }

        .eos-suggestion-arrow {
          color: #94a3b8;
          transition:
            color 180ms ease,
            transform 180ms ease;
        }

        .eos-suggestion-card:hover
          .eos-suggestion-arrow {
          color: #2563eb;
          transform: translate(2px, -2px);
        }

        .eos-suggestion-card strong {
          margin-top: 18px;
          color: #071226;
          font-size: 14px;
          font-weight: 850;
          line-height: 1.25;
        }

        .eos-suggestion-card > span:last-child {
          margin-top: 8px;
          color: #64748b;
          font-size: 11px;
          line-height: 1.55;
        }

        .eos-capabilities {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 20px;
          margin-top: 22px;
          color: #64748b;
          font-size: 10px;
          font-weight: 700;
        }

        .eos-capabilities > span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }

        .eos-capability-dot {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: #2563eb;
        }

        .eos-messages {
          padding-top: 5px;
        }

        .eos-conversation-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 1px solid #e2e8f0;
        }

        .eos-conversation-header p {
          margin: 0;
          color: #2563eb;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.15em;
        }

        .eos-conversation-header h2 {
          margin: 6px 0 0;
          color: #071226;
          font-size: 24px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        .eos-conversation-header > span {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          background: white;
          color: #475569;
          font-size: 10px;
          font-weight: 800;
        }

        .eos-file-row {
          display: flex;
          margin: -8px 0 22px;
          padding-left: 50px;
        }

        .eos-generated-file {
          width: min(100%, 520px);
          display: flex;
          align-items: center;
          gap: 13px;
          padding: 13px;
          border: 1px solid rgba(37, 99, 235, 0.18);
          border-radius: 17px;
          background: #eff6ff;
          color: #071226;
          text-decoration: none;
          transition:
            transform 180ms ease,
            border-color 180ms ease;
        }

        .eos-generated-file:hover {
          transform: translateY(-2px);
          border-color: rgba(37, 99, 235, 0.38);
        }

        .eos-generated-file-icon {
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 13px;
          background: #2563eb;
          color: white;
        }

        .eos-generated-file-info {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 3px;
        }

        .eos-generated-file-info strong {
          font-size: 13px;
          font-weight: 850;
        }

        .eos-generated-file-info small {
          color: #64748b;
          font-size: 10px;
        }

        @media (max-width: 1100px) {
          .eos-suggestion-grid {
            grid-template-columns: repeat(
              2,
              minmax(0, 1fr)
            );
          }
        }

        @media (max-width: 760px) {
          .eos-chat-background {
            left: 0;
          }

          .eos-chat-inner {
            padding: 76px 18px 155px;
          }

          .eos-welcome {
  min-height: auto;
  justify-content: flex-start;
  padding-top: 70px;
}

          .eos-welcome-title {
            font-size: clamp(34px, 10vw, 48px);
          }

          .eos-suggestion-grid {
            grid-template-columns: 1fr;
          }

          .eos-suggestion-card {
            min-height: 142px;
          }

          .eos-conversation-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .eos-file-row {
            padding-left: 0;
          }
        }
      `}</style>
    </div>
  );
}