"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  MessageSquareQuote,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { armarCita, type Cita } from "@/lib/eos/cita";

type MessageBubbleProps = {
  rol: "usuario" | "eos";
  texto: string;
  nombre: string;
  /** Para poder decirle al backend sobre QUÉ mensaje se está preguntando. */
  mensajeId?: string;
  onRegenerar?: () => void;
  regenerando?: boolean;
  /** Sin esto no aparece nada: la burbuja sigue siendo texto y se copia igual. */
  onPreguntarSobre?: (cita: Cita) => void;
};

function esEnlace(texto: string) {
  return (
    texto.startsWith("http://") ||
    texto.startsWith("https://") ||
    texto.startsWith("/descargar")
  );
}

/**
 * Los documentos que arma EOS se guardan como DESCRIPCIÓN, no como archivo, así
 * que el mismo enlace sirve para las tres extensiones: lo único que cambia es
 * `?formato=`. Por eso la burbuja ofrece los tres y no uno solo — pedirle a EOS
 * "ahora pasámelo en PDF" gastaría un mensaje del plan para rehacer algo que ya
 * está hecho.
 */
const FORMATOS_DOCUMENTO = [
  { clave: "excel", etiqueta: "Excel" },
  { clave: "pdf", etiqueta: "PDF" },
  { clave: "word", etiqueta: "Word" },
] as const;

function documentoDeEOS(texto: string): string | null {
  const enlace = texto.match(/^\/api\/documentos\/([0-9a-f-]{36})(\?[^\s]*)?$/i);
  return enlace ? enlace[1] : null;
}

function aprobacionDeEOS(texto: string): string | null {
  const enlace = texto.match(/https?:\/\/[^\s]+\/eos\/autonomy(?:\?[^\s]*)?/i);
  return enlace?.[0] ?? null;
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
  mensajeId = "",
  onRegenerar,
  regenerando = false,
  onPreguntarSobre,
}: MessageBubbleProps) {
  const esUsuario = rol === "usuario";
  const lineas = texto.split("\n");
  const [copiado, setCopiado] = useState(false);

  /*
   * ============================================================
   * PREGUNTAR SOBRE UN PEDAZO
   * ============================================================
   *
   * Se escucha `selectionchange` del documento y NO un `onMouseUp` de la
   * burbuja, por una razón que sólo se ve en el teléfono: ahí la selección la
   * hace el sistema operativo con sus manijas, y no hay ningún evento de mouse
   * que contar. `selectionchange` es el único que llega en los dos lados.
   *
   * Lo que NO se toca es la selección en sí: el menú nativo de copiar sigue
   * apareciendo y el Ctrl+C sigue funcionando. Esto se suma, no reemplaza.
   */
  const articuloRef = useRef<HTMLElement | null>(null);
  const [seleccion, setSeleccion] = useState<{ cita: Cita; x: number; y: number } | null>(null);

  const cerrarMenu = useCallback(() => setSeleccion(null), []);

  useEffect(() => {
    if (esUsuario || !onPreguntarSobre) return;

    function revisar() {
      const articulo = articuloRef.current;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;

      if (!articulo || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSeleccion(null);
        return;
      }

      // Las dos puntas adentro de ESTA burbuja. Una selección que empezó acá y
      // terminó en la de al lado no es una cita de este mensaje.
      const dentro =
        sel.anchorNode !== null &&
        sel.focusNode !== null &&
        articulo.contains(sel.anchorNode) &&
        articulo.contains(sel.focusNode);

      if (!dentro) {
        setSeleccion(null);
        return;
      }

      const cita = armarCita(sel.toString(), texto, mensajeId);
      if (!cita) {
        setSeleccion(null);
        return;
      }

      const rango = sel.getRangeAt(0).getBoundingClientRect();
      const caja = articulo.getBoundingClientRect();

      setSeleccion({
        cita,
        // Relativo a la burbuja: el chat se desplaza y una posición fija
        // quedaría flotando en el medio de la pantalla al hacer scroll.
        x: Math.max(0, Math.min(rango.left + rango.width / 2 - caja.left, caja.width)),
        y: Math.max(0, rango.top - caja.top),
      });
    }

    document.addEventListener("selectionchange", revisar);
    return () => document.removeEventListener("selectionchange", revisar);
  }, [esUsuario, mensajeId, onPreguntarSobre, texto]);

  function preguntarSobreLaSeleccion() {
    if (!seleccion || !onPreguntarSobre) return;

    onPreguntarSobre(seleccion.cita);
    window.getSelection()?.removeAllRanges();
    cerrarMenu();
  }

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
      <div className="message-column">
        <article
          ref={articuloRef}
          className={`message-bubble ${
            esUsuario ? "message-user" : "message-eos"
          }`}
        >
          {seleccion ? (
            <button
              type="button"
              className="message-quote-chip"
              style={{ left: `${seleccion.x}px`, top: `${seleccion.y}px` }}
              /*
                `preventDefault` en el mousedown y en el touchstart: sin esto,
                apretar el botón borra la selección ANTES del click y el
                fragmento llega vacío. Es el detalle que hace que esto ande o
                no ande, y no se ve hasta probarlo.
              */
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={preguntarSobreLaSeleccion}
            >
              <MessageSquareQuote size={13} />
              <span>Preguntar sobre esto</span>
            </button>
          ) : null}

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

              const documentoId = documentoDeEOS(limpio);
              const enlaceAprobacion = aprobacionDeEOS(limpio);

              if (enlaceAprobacion) {
                return (
                  <div key={`aprobacion-${index}`} className="message-approval">
                    <span className="message-approval-icon">
                      <ShieldCheck size={19} />
                    </span>
                    <span className="message-file-text">
                      <strong>Operación lista para registrar</strong>
                      <small>Revisá los datos y confirmá para que EOS la guarde.</small>
                    </span>
                    <a href={enlaceAprobacion} className="message-approval-button">
                      Revisar y aprobar <ArrowUpRight size={15} />
                    </a>
                  </div>
                );
              }

              if (documentoId) {
                return (
                  <div key={`documento-${index}`} className="message-file">
                    <span className="message-file-icon">
                      <Download size={18} />
                    </span>

                    <span className="message-file-text">
                      <strong>Documento listo</strong>
                      <small>Bajalo en el formato que prefieras</small>
                    </span>

                    <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                      {FORMATOS_DOCUMENTO.map((formato) => (
                        <a
                          key={formato.clave}
                          href={`/api/documentos/${documentoId}?formato=${formato.clave}`}
                          className="message-file-formato"
                          rel="noopener noreferrer"
                        >
                          {formato.etiqueta}
                        </a>
                      ))}
                    </span>
                  </div>
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

            {/*
              El camino sin selección, que es el que salva al teléfono.

              En móvil la selección con las manijas del sistema funciona y
              muestra el mismo menú flotante, pero no siempre: hay teclados y
              navegadores donde el menú nativo tapa todo. Este botón cita el
              mensaje entero y deja preguntar igual, que es lo que importa.
            */}
            {onPreguntarSobre ? (
              <button
                type="button"
                onClick={() =>
                  onPreguntarSobre({ texto: texto.trim().slice(0, 1000), mensajeId })
                }
                className="message-action"
                aria-label="Preguntar sobre esta respuesta"
              >
                <MessageSquareQuote size={14} />
                <span>Preguntar</span>
              </button>
            ) : null}

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

      <style jsx>{`
        .message-row {
          width: 100%;
          display: flex;
          align-items: flex-start;
          gap: 0;
          margin-bottom: 18px;
        }

        .message-row-user {
          justify-content: flex-end;
        }

        .message-row-eos {
          justify-content: flex-start;
        }

        .message-column {
          min-width: 0;
          max-width: min(780px, 100%);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .message-row-user .message-column {
          align-items: flex-end;
        }

        .message-bubble {
          width: fit-content;
          max-width: 100%;
          padding: 14px 16px;
          border-radius: 18px;
          font-size: 14px;
          line-height: 1.72;
          box-sizing: border-box;
          /* El chip flotante se ubica contra la burbuja, no contra la ventana. */
          position: relative;
        }

        /*
          El menú de "Preguntar sobre esto".

          Va POR ENCIMA de la selección y centrado en ella, como el de cualquier
          lector: abajo lo taparía el menú nativo del teléfono, que aparece
          exactamente ahí.

          Sin selección propia, para que apretarlo no se sume a la selección
          que justamente estamos por citar.
        */
        .message-quote-chip {
          position: absolute;
          z-index: 5;
          transform: translate(-50%, -118%);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 11px;
          border: 1px solid var(--linea-azul);
          border-radius: 999px;
          background: var(--panel);
          color: var(--blue);
          font-family: inherit;
          font-size: 11px;
          font-weight: 850;
          white-space: nowrap;
          cursor: pointer;
          user-select: none;
          box-shadow: 0 6px 18px var(--sombra);
        }

        .message-quote-chip:hover {
          background: var(--blue-light);
        }

        .message-user {
          border: 1px solid rgba(37, 99, 235, 0.14);
          border-top-right-radius: 6px;
          background: var(--blue-solido);
          color: white;
          box-shadow: none;
        }

        .message-eos {
          border: 0;
          border-radius: 0;
          background: transparent;
          color: var(--ink);
          box-shadow: none;
          padding-left: 0;
          padding-right: 0;
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
          border: 1px solid var(--line);
          border-radius: 7px;
          background: var(--line-soft);
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
          color: var(--blue);
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
          color: var(--blue);
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
          background: var(--blue-light);
          color: var(--ink);
          text-decoration: none;
          transition:
            transform 180ms ease,
            border-color 180ms ease;
        }

        .message-approval {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
          padding: 13px;
          border: 1px solid rgba(37, 99, 235, 0.2);
          border-radius: 15px;
          background: linear-gradient(135deg, var(--blue-light), var(--panel-suave));
        }

        .message-approval-icon {
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 12px;
          background: var(--blue-solido);
          color: white;
        }

        .message-approval-button {
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          flex-shrink: 0;
          padding: 0 13px;
          border-radius: 11px;
          background: var(--blue-solido);
          color: white;
          font-size: 11px;
          font-weight: 850;
          text-decoration: none;
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
          background: var(--blue-solido);
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
          color: var(--muted);
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
          color: var(--muted);
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
          border-color: var(--linea-azul);
          background: var(--blue-light);
          color: var(--blue);
        }

        .message-action:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .message-action-success {
          color: var(--green-texto);
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
          .message-column {
            max-width: 100%;
          }

          .message-bubble {
            padding: 14px 15px;
            font-size: 13px;
          }

          .message-approval {
            align-items: flex-start;
            flex-wrap: wrap;
          }

          .message-approval-button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
