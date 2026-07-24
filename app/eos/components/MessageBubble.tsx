"use client";

import Image from "next/image";
import {
  ArrowUpRight,
  Download,
  Sparkles,
  UserRound,
} from "lucide-react";

type MessageBubbleProps = {
  rol: "usuario" | "eos";
  texto: string;
  nombre: string;
};

function obtenerIniciales(nombre: string) {
  const limpio = nombre.trim();

  if (!limpio) return "U";

  return limpio
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");
}

function esEnlace(texto: string) {
  return (
    texto.startsWith("http://") ||
    texto.startsWith("https://") ||
    texto.startsWith("/descargar")
  );
}

export default function MessageBubble({
  rol,
  texto,
  nombre,
}: MessageBubbleProps) {
  const esUsuario = rol === "usuario";
  const lineas = texto.split("\n");

  return (
    <div
      className={`message-row ${
        esUsuario ? "message-row-user" : "message-row-eos"
      }`}
    >
      {!esUsuario ? (
       <div className="message-avatar message-avatar-eos">
  <Image
    src="/transtech-logo.png"
    alt="Logo de TRANSTECH"
    width={24}
    height={24}
    className="message-avatar-logo"
  />
</div>
      ) : null}

      <article
        className={`message-bubble ${
          esUsuario ? "message-user" : "message-eos"
        }`}
      >
        <div className="message-meta">
          {esUsuario ? nombre : "TRANSTECH EOS"}
        </div>

        <div className="message-content">
          {lineas.map((linea, index) => {
            const limpio = linea.trim();

            if (!limpio) {
              return (
                <div
                  key={`space-${index}`}
                  className="message-space"
                />
              );
            }

            if (esEnlace(limpio)) {
              return (
                <a
                  key={`link-${index}`}
                  href={limpio}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="message-file"
                >
                  <span className="message-file-icon">
                    <Download size={18} />
                  </span>

                  <span className="message-file-text">
                    <strong>Descargar archivo</strong>
                    <small>Documento generado por EOS</small>
                  </span>

                  <ArrowUpRight size={17} />
                </a>
              );
            }

            if (
              limpio.startsWith("•") ||
              limpio.startsWith("-")
            ) {
              return (
                <div
                  key={`bullet-${index}`}
                  className="message-bullet"
                >
                  <span className="message-bullet-dot" />

                  <span>
                    {limpio.replace(/^[-•]\s*/, "")}
                  </span>
                </div>
              );
            }

            if (/^\d+\./.test(limpio)) {
              const coincidencia = limpio.match(
                /^(\d+)\.\s*(.*)$/,
              );

              return (
                <div
                  key={`number-${index}`}
                  className="message-numbered"
                >
                  <span>
                    {coincidencia?.[1] ?? index + 1}
                  </span>

                  <p>{coincidencia?.[2] ?? limpio}</p>
                </div>
              );
            }

            if (
              limpio.startsWith("### ") ||
              limpio.startsWith("## ") ||
              limpio.startsWith("# ")
            ) {
              return (
                <h3
                  key={`heading-${index}`}
                  className="message-heading"
                >
                  {limpio.replace(/^#{1,3}\s*/, "")}
                </h3>
              );
            }

            return (
              <p
                key={`paragraph-${index}`}
                className="message-paragraph"
              >
                {linea}
              </p>
            );
          })}
        </div>
      </article>

      {esUsuario ? (
        <div className="message-avatar message-avatar-user">
          <span className="message-user-initials">
            {obtenerIniciales(nombre)}
          </span>

          <UserRound
            size={15}
            className="message-user-icon"
          />
        </div>
      ) : null}

      <style jsx>{`
        .message-row {
          width: 100%;
          display: flex;
          align-items: flex-start;
          gap: 11px;
          margin-bottom: 22px;
        }

        .message-row-user {
          justify-content: flex-end;
        }

        .message-row-eos {
          justify-content: flex-start;
        }

        .message-avatar {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 13px;
        }

        .message-avatar-eos {
  border: 1px solid rgba(37, 99, 235, 0.16);
  background: #ffffff;
  box-shadow: 0 10px 25px rgba(37, 99, 235, 0.12);
}

.message-avatar-logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

        .message-avatar-user {
          position: relative;
          border: 1px solid #dbe3ef;
          background: white;
          color: #071226;
          overflow: hidden;
        }

        .message-user-icon {
          display: none;
        }

        .message-user-initials {
          font-size: 10px;
          font-weight: 900;
        }

        .message-bubble {
          max-width: min(760px, calc(100% - 52px));
          padding: 16px 18px;
          border-radius: 20px;
          font-size: 14px;
          line-height: 1.72;
        }

        .message-user {
          border: 1px solid rgba(37, 99, 235, 0.14);
          border-top-right-radius: 7px;
          background: #2563eb;
          color: white;
          box-shadow: 0 10px 30px rgba(37, 99, 235, 0.14);
        }

        .message-eos {
          border: 1px solid #e2e8f0;
          border-top-left-radius: 7px;
          background: rgba(255, 255, 255, 0.94);
          color: #172033;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.05);
        }

        .message-meta {
          margin-bottom: 8px;
          color: inherit;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.1em;
          opacity: 0.68;
        }

        .message-content {
          display: block;
        }

        .message-space {
          height: 7px;
        }

        .message-paragraph {
          margin: 0 0 9px;
          white-space: pre-wrap;
        }

        .message-paragraph:last-child {
          margin-bottom: 0;
        }

        .message-heading {
          margin: 16px 0 8px;
          color: inherit;
          font-size: 16px;
          font-weight: 900;
          line-height: 1.3;
          letter-spacing: -0.02em;
        }

        .message-bullet {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 6px 0;
        }

        .message-bullet-dot {
          width: 6px;
          height: 6px;
          flex-shrink: 0;
          margin-top: 9px;
          border-radius: 999px;
          background: currentColor;
          opacity: 0.65;
        }

        .message-numbered {
          display: grid;
          grid-template-columns: 25px minmax(0, 1fr);
          gap: 9px;
          align-items: flex-start;
          margin: 7px 0;
        }

        .message-numbered > span {
          width: 23px;
          height: 23px;
          display: grid;
          place-items: center;
          margin-top: 1px;
          border-radius: 8px;
          background: rgba(37, 99, 235, 0.1);
          color: #2563eb;
          font-size: 10px;
          font-weight: 900;
        }

        .message-user .message-numbered > span {
          background: rgba(255, 255, 255, 0.17);
          color: white;
        }

        .message-numbered p {
          margin: 0;
        }

        .message-file {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
          padding: 12px;
          border: 1px solid rgba(37, 99, 235, 0.16);
          border-radius: 15px;
          background: #eff6ff;
          color: #071226;
          text-decoration: none;
          transition:
            transform 180ms ease,
            border-color 180ms ease;
        }

        .message-file:hover {
          transform: translateY(-2px);
          border-color: rgba(37, 99, 235, 0.35);
        }

        .message-file-icon {
          width: 39px;
          height: 39px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 12px;
          background: #2563eb;
          color: white;
        }

        .message-file-text {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 2px;
        }

        .message-file-text strong {
          font-size: 12px;
          font-weight: 850;
        }

        .message-file-text small {
          color: #64748b;
          font-size: 9px;
        }

        @media (max-width: 620px) {
          .message-avatar {
            width: 34px;
            height: 34px;
            border-radius: 11px;
          }

          .message-bubble {
            max-width: calc(100% - 45px);
            padding: 14px 15px;
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
}