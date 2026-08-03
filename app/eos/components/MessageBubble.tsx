"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  RefreshCw,
  UserRound,
} from "lucide-react";

type MessageBubbleProps = {
  rol: "usuario" | "eos";
  texto: string;
  nombre: string;
  onRegenerar?: () => void;
  regenerando?: boolean;
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

function renderizarTextoEnLinea(texto: string) {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s]+)/g);

  return partes.map((parte, index) => {
    if (!parte) return null;

    if (parte.startsWith("**") && parte.endsWith("**")) {
      return <strong key={`bold-${index}`}>{parte.slice(2, -2)}</strong>;
    }

    if (parte.startsWith("`") && parte.endsWith("`")) {
      return <code key={`code-${index}`}>{parte.slice(1, -1)}</code>;
    }

    if (/^https?:\/\//i.test(parte)) {
      return (
        <a
          key={`inline-link-${index}`}
          href={parte}
          target="_blank"
          rel="noopener noreferrer"
          className="message-inline-link"
        >
          {parte}
        </a>
      );
    }

    return <span key={`text-${index}`}>{parte}</span>;
  });
}

export default function MessageBubble({
  rol,
  texto,
  nombre,
  onRegenerar,
  regenerando = false,
}: MessageBubbleProps) {
  const esUsuario = rol === "usuario";
  const lineas = texto.split("\n");
  const [copiado, setCopiado] = useState(false);

  async function copiarMensaje() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);

      window.setTimeout(() => {
        setCopiado(false);
      }, 1800);
    } catch (error) {
      console.error("No se pudo copiar el mensaje:", error);
    }
  }

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

      <div className="message-column">
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
                      {renderizarTextoEnLinea(
                        limpio.replace(/^[-•]\s*/, ""),
                      )}
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

                    <p>
                      {renderizarTextoEnLinea(
                        coincidencia?.[2] ?? limpio,
                      )}
                    </p>
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
                    {renderizarTextoEnLinea(
                      limpio.replace(/^#{1,3}\s*/, ""),
                    )}
                  </h3>
                );
              }

              return (
                <p
                  key={`paragraph-${index}`}
                  className="message-paragraph"
                >
                  {renderizarTextoEnLinea(linea)}
                </p>
              );
            })}
          </div>
        </article>

        {!esUsuario ? (
          <div className="message-actions">
            <button
              type="button"
              onClick={copiarMensaje}
              className={`message-action ${
                copiado ? "message-action-success" : ""
              }`}
              aria-label={
                copiado
                  ? "Mensaje copiado"
                  : "Copiar respuesta de EOS"
              }
            >
              {copiado ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiado ? "Copiado" : "Copiar"}</span>
            </button>

            {onRegenerar ? (
              <button
                type="button"
                onClick={onRegenerar}
                disabled={regenerando}
                className="message-action"
                aria-label="Regenerar respuesta de EOS"
              >
                <RefreshCw
                  size={14}
                  className={regenerando ? "message-regenerating" : ""}
                />
                <span>
                  {regenerando ? "Regenerando" : "Regenerar"}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

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

        .message-column {
          min-width: 0;
          max-width: min(760px, calc(100% - 52px));
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .message-row-user .message-column {
          align-items: flex-end;
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
          overflow: hidden;
          border: 1px solid #dbe3ef;
          background: white;
          color: #071226;
        }

        .message-user-icon {
          display: none;
        }

        .message-user-initials {
          font-size: 10px;
          font-weight: 900;
        }

        .message-bubble {
          width: fit-content;
          max-width: 100%;
          padding: 16px 18px;
          border-radius: 20px;
          font-size: 14px;
          line-height: 1.72;
          box-sizing: border-box;
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
          overflow-wrap: anywhere;
        }

        .message-content :global(strong) {
          font-weight: 900;
        }

        .message-content :global(code) {
          padding: 2px 6px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 7px;
          background: rgba(15, 23, 42, 0.06);
          font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
          font-size: 0.88em;
        }

        .message-user .message-content :global(code) {
          border-color: rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.13);
        }

        .message-content :global(.message-inline-link) {
          color: #2563eb;
          font-weight: 750;
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .message-user
          .message-content
          :global(.message-inline-link) {
          color: #ffffff;
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

        .message-heading:first-child {
          margin-top: 0;
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

        .message-actions {
          display: flex;
          align-items: center;
          gap: 7px;
          min-height: 30px;
          margin-top: 6px;
          padding-left: 3px;
        }

        .message-action {
          min-height: 29px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 9px;
          border: 1px solid transparent;
          border-radius: 9px;
          background: transparent;
          color: #64748b;
          font-family: inherit;
          font-size: 10px;
          font-weight: 750;
          cursor: pointer;
          transition:
            color 160ms ease,
            background 160ms ease,
            border-color 160ms ease;
        }

        .message-action:hover {
          border-color: #dbeafe;
          background: #eff6ff;
          color: #2563eb;
        }

        .message-action:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .message-action-success {
          color: #15803d;
        }

        .message-regenerating {
          animation: message-spin 0.85s linear infinite;
        }

        @keyframes message-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 620px) {
          .message-avatar {
            width: 34px;
            height: 34px;
            border-radius: 11px;
          }

          .message-column {
            max-width: calc(100% - 45px);
          }

          .message-bubble {
            padding: 14px 15px;
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
}