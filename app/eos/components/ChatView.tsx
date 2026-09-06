"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send } from "lucide-react";
import MessageBubble from "./MessageBubble";
import type { ArchivoAdjunto, Mensaje } from "../types/chat";
import { debeEnviarConEnter } from "@/lib/eos/composer";
import { fusionarDictado } from "@/lib/eos/dictado";
import { useDictado, type Dictado } from "./useDictado";

type PromptCard = {
  key: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  prompt: string;
};

const PROMPTS: PromptCard[] = [
  {
    key: "finanzas",
    icon: (
      <svg viewBox="0 0 24 24">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    title: "Finanzas",
    subtitle: "Analizá el flujo de caja del mes",
    prompt: "Analizá el flujo de caja del mes",
  },
  {
    key: "negocio",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 3v18h18" />
        <path d="M18 17V9M13 17V5M8 17v-3" />
      </svg>
    ),
    title: "Negocio",
    subtitle: "Resumen de objetivos del Q3",
    prompt: "Dame un resumen de mis objetivos actuales",
  },
  {
    key: "documentos",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
    title: "Documentos",
    subtitle: "Buscá en tus documentos",
    prompt: "Buscá en mis documentos",
  },
  {
    key: "tareas",
    icon: (
      <svg viewBox="0 0 24 24">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: "Tareas",
    subtitle: "¿Qué tengo pendiente hoy?",
    prompt: "¿Qué tengo pendiente hoy?",
  },
];

type ChatViewProps = {
  historial: Mensaje[];
  nombre: string;
  mensaje: string;
  cargando: boolean;
  archivoAdjunto: ArchivoAdjunto | null;
  chatRef: React.RefObject<HTMLDivElement | null>;
  onMensajeChange: (value: string) => void;
  onEnviar: (texto?: string) => void;
  onArchivoSeleccionado: (file: File) => void;
  onQuitarArchivo: () => void;
  obtenerEtiquetaArchivo: (archivo: ArchivoAdjunto) => string;
  formatearTamanio: (bytes?: number) => string;
  onRegenerar?: () => void;
};

export default function ChatView({
  historial,
  nombre,
  mensaje,
  cargando,
  archivoAdjunto,
  chatRef,
  onMensajeChange,
  onEnviar,
  onArchivoSeleccionado,
  onQuitarArchivo,
  obtenerEtiquetaArchivo,
  formatearTamanio,
  onRegenerar,
}: ChatViewProps) {
  const started = historial.length > 0;
  const [focused, setFocused] = useState(false);
  const [esMovil, setEsMovil] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /*
   * El texto actual en un ref para que el dictado no lo pise.
   *
   * `useDictado` guarda el callback una sola vez; si acá se le pasara una
   * clausura sobre `mensaje`, cada tramo dictado se sumaría al texto que había
   * cuando arrancó el micrófono y borraría lo dictado antes.
   */
  const mensajeRef = useRef(mensaje);

  useEffect(() => {
    mensajeRef.current = mensaje;
  }, [mensaje]);

  const dictado = useDictado((texto) => {
    onMensajeChange(fusionarDictado(mensajeRef.current, texto));
  });

  useEffect(() => {
    const media = window.matchMedia("(hover: none), (pointer: coarse), (max-width: 700px)");
    const actualizar = () => setEsMovil(media.matches);
    actualizar();
    media.addEventListener("change", actualizar);
    return () => media.removeEventListener("change", actualizar);
  }, []);

  const primerNombre = nombre.split(" ")[0] || nombre;
  const palabrasSaludo = `Hola, ${primerNombre}`.split(" ");

  function enviar(texto?: string) {
    onEnviar(texto);
  }

  function manejarTecla(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      debeEnviarConEnter({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
        esMovil,
      })
    ) {
      event.preventDefault();
      enviar();
    }
  }

  function manejarArchivoInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onArchivoSeleccionado(file);
    event.target.value = "";
  }

  return (
    <div className="view" id="view-chat" style={{ display: "flex", flexDirection: "column" }}>
      {!started && (
        <div className="hero-wrap">
          <div className="greet-stage">
            <div className="greet">
              {palabrasSaludo.map((palabra, idx) => (
                <span
                  key={`${palabra}-${idx}`}
                  className="word"
                  style={{ animationDelay: `${0.05 + idx * 0.11}s, 1.4s` }}
                >
                  {palabra}
                </span>
              ))}
            </div>
          </div>
          <div className="greet-sub">¿En qué te ayudo hoy?</div>

          <div className="prompts">
            {PROMPTS.map((p) => (
              <button key={p.key} type="button" className="prompt-card" onClick={() => enviar(p.prompt)}>
                <div className="ic">{p.icon}</div>
                <div className="t">{p.title}</div>
                <div className="s">{p.subtitle}</div>
              </button>
            ))}
          </div>

          <div className="composer-wrap">
            <Composer
              mensaje={mensaje}
              cargando={cargando}
              archivoAdjunto={archivoAdjunto}
              focused={focused}
              setFocused={setFocused}
              onMensajeChange={onMensajeChange}
              onKeyDown={manejarTecla}
              onEnviar={() => enviar()}
              onArchivoClick={() => fileInputRef.current?.click()}
              onQuitarArchivo={onQuitarArchivo}
              esMovil={esMovil}
              obtenerEtiquetaArchivo={obtenerEtiquetaArchivo}
              formatearTamanio={formatearTamanio}
              dictado={dictado}
            />
          </div>
        </div>
      )}

      {started && (
        <div className="chat-wrap">
          <div className="messages" ref={chatRef}>
            {historial.map((m, i) => {
              /*
               * Solo la ÚLTIMA burbuja de EOS puede regenerarse: `regenerarRespuesta`
               * (en useChat.ts) resuelve "el último mensaje del usuario" y "la
               * última respuesta de EOS" sin más contexto, así que ofrecerlo en un
               * intercambio viejo regeneraría el más reciente, no el que se tocó.
               *
               * Esto es también el "reintentar" del punto 14 de la lista de
               * lanzamiento: un mensaje que terminó en error es una burbuja de EOS
               * como cualquier otra (`estado: "error"`), así que el mismo botón
               * sirve para las dos cosas sin duplicar nada.
               */
              const esUltimaDeEOS = m.rol === "eos" && i === historial.length - 1;

              return (
                <div className="msg-col" key={m.id ?? i}>
                  <MessageBubble
                    rol={m.rol}
                    texto={m.texto}
                    nombre={nombre}
                    onRegenerar={esUltimaDeEOS ? onRegenerar : undefined}
                    regenerando={esUltimaDeEOS && cargando}
                  />
                </div>
              );
            })}
            {cargando && (
              <div className="msg-row assistant">
                <div className="assistant-content">
                  <div className="assistant-name">
                    <span className="think-dot" />
                    EOS
                  </div>
                  <div className="typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="composer-wrap docked">
            <Composer
              mensaje={mensaje}
              cargando={cargando}
              archivoAdjunto={archivoAdjunto}
              focused={focused}
              setFocused={setFocused}
              onMensajeChange={onMensajeChange}
              onKeyDown={manejarTecla}
              onEnviar={() => enviar()}
              onArchivoClick={() => fileInputRef.current?.click()}
              onQuitarArchivo={onQuitarArchivo}
              esMovil={esMovil}
              obtenerEtiquetaArchivo={obtenerEtiquetaArchivo}
              formatearTamanio={formatearTamanio}
              dictado={dictado}
            />
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" hidden onChange={manejarArchivoInput} />
    </div>
  );
}

type ComposerProps = {
  mensaje: string;
  cargando: boolean;
  archivoAdjunto: ArchivoAdjunto | null;
  focused: boolean;
  setFocused: (v: boolean) => void;
  onMensajeChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onEnviar: () => void;
  onArchivoClick: () => void;
  onQuitarArchivo: () => void;
  esMovil: boolean;
  obtenerEtiquetaArchivo: (archivo: ArchivoAdjunto) => string;
  formatearTamanio: (bytes?: number) => string;
  dictado: Dictado;
};

function Composer({
  mensaje,
  cargando,
  archivoAdjunto,
  focused,
  setFocused,
  onMensajeChange,
  onKeyDown,
  onEnviar,
  onArchivoClick,
  onQuitarArchivo,
  esMovil,
  obtenerEtiquetaArchivo,
  formatearTamanio,
  dictado,
}: ComposerProps) {
  const listo = mensaje.trim().length > 0 || Boolean(archivoAdjunto);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [mensaje]);

  return (
    <>
      {archivoAdjunto && (
        <div className="file-preview">
          <div className="file-preview-info">
            <span className="file-preview-ic">{obtenerEtiquetaArchivo(archivoAdjunto)}</span>
            <span className="file-preview-text">
              <small>
                {obtenerEtiquetaArchivo(archivoAdjunto)} ADJUNTO
                {archivoAdjunto.tamanio ? ` · ${formatearTamanio(archivoAdjunto.tamanio)}` : ""}
              </small>
              <strong>{archivoAdjunto.nombre}</strong>
            </span>
          </div>
          <button type="button" onClick={onQuitarArchivo}>
            Quitar
          </button>
        </div>
      )}

      <div className={`composer ${focused ? "focused" : ""}`}>
        <button type="button" className="icon-btn" onClick={onArchivoClick} aria-label="Adjuntar archivo">
          <Paperclip size={18} />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          aria-label="Escribile a EOS"
          placeholder="Escribile a EOS..."
          value={mensaje}
          onChange={(e) => onMensajeChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {/*
          El micrófono solo aparece donde el navegador puede dictar. Un botón
          gris con "próximamente" ocupa el mismo lugar y no hace nada; peor,
          invita a apretarlo. Firefox no tiene reconocimiento de voz y no lo
          va a tener pronto, así que ahí simplemente no hay micrófono.
        */}
        {dictado.soportado && (
          <button
            type="button"
            className={`icon-btn ${dictado.escuchando ? "escuchando" : ""}`}
            onClick={dictado.alternar}
            aria-label={dictado.escuchando ? "Dejar de dictar" : "Dictar el mensaje"}
            aria-pressed={dictado.escuchando}
            title={dictado.escuchando ? "Dejar de dictar" : "Dictar el mensaje"}
          >
            <Mic size={18} />
          </button>
        )}
        <button
          type="button"
          className={`send-btn ${listo ? "ready" : ""}`}
          onClick={onEnviar}
          disabled={!listo || cargando}
          aria-label="Enviar"
        >
          <Send size={16} />
        </button>
      </div>
      {/*
        Lo que se está escuchando ahora mismo, en gris y fuera del campo.
        Escribirlo dentro del textarea sería mentir sobre lo que se va a
        mandar: el navegador todavía puede corregirlo entero.

        `aria-live` para que un lector de pantalla lo diga sin robar el foco:
        quien no ve la pantalla necesita saber que lo están escuchando, y
        necesita saberlo mientras habla.
      */}
      <div className="composer-dictado" aria-live="polite">
        {dictado.escuchando && (
          <span className="dictado-estado">
            {dictado.provisorio ? dictado.provisorio : "Escuchando…"}
          </span>
        )}
        {dictado.error && <span className="dictado-error" role="alert">{dictado.error}</span>}
      </div>

      <div className="composer-help">
        {esMovil ? "Enter crea un salto · Tocá enviar para mandar" : "Enter para enviar · Shift + Enter para un salto"}
      </div>
      <div className="hint">EOS puede cometer errores. Verificá la información importante antes de tomar decisiones.</div>
    </>
  );
}
