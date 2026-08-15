"use client";

import {
  ArrowUp,
  FileText,
  LoaderCircle,
  Paperclip,
  Sparkles,
} from "lucide-react";

type ComposerProps = {
  mensaje: string;
  cargando: boolean;
  onMensajeChange: (value: string) => void;
  onEnviar: () => void;
  onArchivoSeleccionado?: (file: File) => void;
  onImagenSeleccionada?: (file: File) => void;
  mobile?: boolean;
};

export default function Composer({
  mensaje,
  cargando,
  onMensajeChange,
  onEnviar,
  onArchivoSeleccionado,
  onImagenSeleccionada,
  mobile = false,
}: ComposerProps) {
  const puedeEnviar = mensaje.trim().length > 0 && !cargando;
  const documentosHabilitados = Boolean(onArchivoSeleccionado);

  function enviar() {
    if (!puedeEnviar) return;
    onEnviar();
  }

  return (
    <div
      className={`tt-composer-dock ${
        mobile ? "tt-composer-dock-mobile" : ""
      }`}
    >
      <div className="tt-composer-shell">
        <div className="tt-composer-box">
          <label
            className="tt-attach-button"
            title={
              documentosHabilitados
                ? "Adjuntar imagen o documento"
                : "Adjuntar una imagen"
            }
          >
            <Paperclip size={19} strokeWidth={2.2} />

            <input
              type="file"
              accept={
                documentosHabilitados
                  ? "image/jpeg,image/png,image/webp,application/pdf,text/plain,text/csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  : "image/*"
              }
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file && onArchivoSeleccionado) {
                  onArchivoSeleccionado(file);
                } else if (file && file.type.startsWith("image/") && onImagenSeleccionada) {
                  onImagenSeleccionada(file);
                }

                event.target.value = "";
              }}
            />
          </label>

          <div className="tt-composer-content">
            <textarea
              value={mensaje}
              onChange={(event) => onMensajeChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escribile a EOS..."
              rows={1}
              className="tt-composer-textarea"
            />

            <div className="tt-composer-meta">
              <span className="tt-memory-label">
                <Sparkles size={11} strokeWidth={2.2} />
                Memoria activa
              </span>

              <span>Enter para enviar</span>
              <span>Shift + Enter para nueva línea</span>
            </div>
          </div>

          <button
            type="button"
            onClick={enviar}
            disabled={!puedeEnviar}
            className={`tt-send-button ${
              puedeEnviar ? "tt-send-active" : "tt-send-disabled"
            }`}
            aria-label={
              cargando ? "EOS está respondiendo" : "Enviar mensaje"
            }
          >
            {cargando ? (
              <LoaderCircle size={20} className="tt-loader" />
            ) : (
              <ArrowUp size={21} strokeWidth={2.5} />
            )}
          </button>
        </div>

        <div className="tt-composer-footer">
          <span>
            <span className="tt-online-dot" />
            EOS conectado
          </span>

          <p>
            EOS puede cometer errores. Verificá la información importante antes
            de tomar decisiones.
          </p>

          <span>
            <FileText size={12} />
            {documentosHabilitados ? "Imágenes y documentos" : "Imágenes habilitadas"}
          </span>
        </div>
      </div>

      <style jsx>{`
        .tt-composer-dock {
          position: fixed;
          right: 0;
          bottom: 0;
          left: 280px;
          z-index: 40;
          padding: 34px 24px 14px;
          background: linear-gradient(
            to top,
            #f7faff 68%,
            rgba(247, 250, 255, 0.96) 82%,
            rgba(247, 250, 255, 0)
          );
          pointer-events: none;
        }

        .tt-composer-dock-mobile {
          position: relative;
          right: auto;
          bottom: auto;
          left: auto;
          flex: 0 0 auto;
          width: 100%;
          padding:
            10px 12px
            calc(10px + env(safe-area-inset-bottom));
          background: #f7faff;
          border-top: 1px solid rgba(148, 163, 184, 0.16);
          pointer-events: auto;
        }

        .tt-composer-shell {
          width: 100%;
          max-width: 930px;
          margin: 0 auto;
          pointer-events: auto;
        }

        .tt-composer-box {
          position: relative;
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 10px;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow:
            0 20px 60px rgba(15, 23, 42, 0.11),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            transform 180ms ease;
        }

        .tt-composer-box::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(
              circle at top right,
              rgba(37, 99, 235, 0.08),
              transparent 38%
            ),
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.35),
              transparent
            );
        }

        .tt-composer-box:focus-within {
          border-color: rgba(37, 99, 235, 0.42);
          box-shadow:
            0 22px 65px rgba(15, 23, 42, 0.13),
            0 0 0 4px rgba(37, 99, 235, 0.07);
          transform: translateY(-1px);
        }

        .tt-attach-button,
        .tt-composer-content,
        .tt-send-button {
          position: relative;
          z-index: 1;
        }

        .tt-attach-button {
          width: 44px;
          height: 44px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 14px;
          background: #f8fafc;
          color: #64748b;
          cursor: pointer;
        }

        .tt-composer-content {
          min-width: 0;
          flex: 1;
        }

        .tt-composer-textarea {
          width: 100%;
          min-height: 26px;
          max-height: 150px;
          display: block;
          resize: none;
          overflow-y: auto;
          padding: 4px 5px 1px;
          border: 0;
          outline: 0;
          background: transparent;
          color: #071226;
          font-family: inherit;
          font-size: 15px;
          font-weight: 550;
          line-height: 1.5;
          box-sizing: border-box;
        }

        .tt-composer-textarea::placeholder {
          color: #94a3b8;
        }

        .tt-composer-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          min-height: 17px;
          padding: 4px 5px 0;
          color: #94a3b8;
          font-size: 8px;
          font-weight: 750;
        }

        .tt-composer-meta > span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .tt-memory-label {
          color: #2563eb;
        }

        .tt-send-button {
          width: 46px;
          height: 46px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 15px;
        }

        .tt-send-active {
          background: #071226;
          color: white;
          cursor: pointer;
          box-shadow: 0 13px 30px rgba(7, 18, 38, 0.22);
        }

        .tt-send-disabled {
          background: #e8edf4;
          color: #a4b0bf;
          cursor: not-allowed;
        }

        .tt-loader {
          animation: tt-spin 0.9s linear infinite;
        }

        .tt-composer-footer {
          min-height: 22px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 16px;
          padding: 8px 10px 0;
          color: #94a3b8;
          font-size: 8px;
          font-weight: 700;
        }

        .tt-composer-footer p {
          margin: 0;
          text-align: center;
        }

        .tt-composer-footer > span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .tt-composer-footer > span:last-child {
          justify-self: end;
        }

        .tt-online-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.62);
        }

        @keyframes tt-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 760px) {
          .tt-composer-dock:not(.tt-composer-dock-mobile) {
            left: 0;
            padding: 25px 12px 10px;
          }

          .tt-composer-box {
            border-radius: 20px;
          }

          .tt-composer-footer {
            display: flex;
            justify-content: center;
          }

          .tt-composer-footer > span {
            display: none;
          }

          .tt-composer-meta > span:nth-child(2),
          .tt-composer-meta > span:nth-child(3) {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
