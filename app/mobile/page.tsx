"use client";

import { createClient } from "@/lib/supabase/client";
import { LogOut, Plus, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import ChatView from "../eos/components/ChatView";
import Composer from "../eos/components/Composer";

import { useBriefing } from "../eos/hooks/useBriefing";
import { useConversations } from "../eos/hooks/useConversations";
import { useChat } from "../eos/hooks/useChat";

import { convertirImagenABase64 } from "../eos/services/uploads";

export default function MobileEOSPage() {
  const router = useRouter();

  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [usuarioId, setUsuarioId] = useState("");
  const [inicializando, setInicializando] = useState(true);
  const [menuAbierto, setMenuAbierto] = useState(false);

  const chatRef = useRef<HTMLDivElement | null>(null);

  const { cargarBriefing } = useBriefing(nombre);

  const {
    conversacionId,
    historial,
    setHistorial,
    cargarConversaciones,
    nuevaConversacion,
    actualizarTituloSiHaceFalta,
  } = useConversations(nombre);

  const {
    mensaje,
    setMensaje,
    cargando,
    imagenAdjunta,
    setImagenAdjunta,
    enviarMensaje,
  } = useChat({
    usuarioId,
    nombre,
    plan,
    conversacionId,
    historial,
    setHistorial,
    nuevaConversacion,
    actualizarTituloSiHaceFalta,
    cargarBriefing,
  });

  useEffect(() => {
    iniciarAplicacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      chatRef.current?.scrollTo({
        top: chatRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 100);

    return () => window.clearTimeout(timeout);
  }, [historial]);

  async function iniciarAplicacion() {
    const supabase = createClient();

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      router.replace("/login?next=/mobile");
      return;
    }

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("nombre, plan")
      .eq("id", user.id)
      .maybeSingle();

    const nombreUsuario =
      usuario?.nombre ??
      user.user_metadata?.nombre ??
      user.email?.split("@")[0] ??
      "Usuario";

    const planUsuario = usuario?.plan ?? "free";

    setUsuarioId(user.id);
    setNombre(nombreUsuario);
    setPlan(planUsuario);

    await cargarBriefing(user.id);
    await cargarConversaciones(user.id, nombreUsuario);

    setInicializando(false);
  }

  async function nuevoChat() {
    if (!usuarioId) return;

    await nuevaConversacion(usuarioId);
    setMenuAbierto(false);
  }

  async function cerrarSesion() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login?next=/mobile");
    router.refresh();
  }

  async function manejarImagen(file: File) {
    try {
      const imagen = await convertirImagenABase64(file);
      setImagenAdjunta(imagen);

      if (!mensaje.trim()) {
        setMensaje(`Analizá esta imagen: ${imagen.nombre}`);
      }
    } catch (error) {
      console.error("No se pudo cargar la imagen:", error);
      window.alert("No se pudo cargar la imagen.");
    }
  }

  function quitarImagenAdjunta() {
    setImagenAdjunta(null);

    if (mensaje.startsWith("Analizá esta imagen:")) {
      setMensaje("");
    }
  }

  if (inicializando) {
    return (
      <main className="mobile-loading">
        <div className="mobile-loading-logo">EOS</div>
        <p>Preparando tu espacio...</p>

        <style jsx>{`
          .mobile-loading {
            width: 100vw;
            height: 100dvh;
            display: grid;
            place-content: center;
            gap: 18px;
            text-align: center;
            background:
              radial-gradient(circle at 50% 10%, rgba(37, 99, 235, 0.18), transparent 34%),
              linear-gradient(180deg, #07101d 0%, #091524 58%, #07111f 100%);
            color: white;
            font-family: Inter, Arial, sans-serif;
          }

          .mobile-loading-logo {
            width: 76px;
            height: 76px;
            display: grid;
            place-items: center;
            margin: 0 auto;
            border: 1px solid rgba(96, 165, 250, 0.35);
            border-radius: 24px;
            background: rgba(37, 99, 235, 0.14);
            box-shadow: 0 20px 60px rgba(37, 99, 235, 0.22);
            font-size: 22px;
            font-weight: 900;
            letter-spacing: 0.08em;
          }

          p {
            margin: 0;
            color: #94a3b8;
            font-size: 14px;
          }
        `}</style>
      </main>
    );
  }

  return (
    <main className="mobile-eos">
      <header className="mobile-header">
        <div>
          <span className="mobile-label">TRANSTECH</span>
          <h1>EOS</h1>
        </div>

        <div className="mobile-actions">
          <button
            type="button"
            onClick={nuevoChat}
            aria-label="Nueva conversación"
          >
            <Plus size={20} />
          </button>

          <button
            type="button"
            onClick={() => setMenuAbierto((actual) => !actual)}
            aria-label="Abrir configuración"
          >
            <Settings size={19} />
          </button>
        </div>

        {menuAbierto && (
          <div className="mobile-menu">
            <div className="mobile-user">
              <strong>{nombre}</strong>
              <span>Plan {plan}</span>
            </div>

            <button type="button" onClick={cerrarSesion}>
              <LogOut size={17} />
              Cerrar sesión
            </button>
          </div>
        )}
      </header>

      <section className="mobile-chat">
        <ChatView
          historial={historial}
          nombre={nombre}
          chatRef={chatRef}
          onEnviarSugerencia={(texto) => enviarMensaje(texto)}
        />

        {imagenAdjunta && (
          <div className="mobile-image-preview">
            <div>
              <small>IMAGEN ADJUNTA</small>
              <strong>{imagenAdjunta.nombre}</strong>
            </div>

            <button type="button" onClick={quitarImagenAdjunta}>
              Quitar
            </button>
          </div>
        )}

        <Composer
          mensaje={mensaje}
          cargando={cargando}
          onMensajeChange={setMensaje}
          onEnviar={() => enviarMensaje()}
          onImagenSeleccionada={manejarImagen}
        />
      </section>

      <style jsx>{`
        .mobile-eos {
          width: 100vw;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background:
            radial-gradient(circle at 88% 3%, rgba(14, 165, 233, 0.08), transparent 28%),
            linear-gradient(180deg, #07101d 0%, #091524 54%, #07111f 100%);
          color: white;
          font-family: Inter, Arial, Helvetica, sans-serif;
        }

        .mobile-header {
          position: relative;
          z-index: 50;
          min-height: 72px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding:
            calc(10px + env(safe-area-inset-top))
            16px
            10px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.13);
          background: rgba(7, 16, 29, 0.88);
          backdrop-filter: blur(20px);
        }

        .mobile-label {
          display: block;
          margin-bottom: 2px;
          color: #60a5fa;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.18em;
        }

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 900;
          letter-spacing: -0.04em;
        }

        .mobile-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .mobile-actions button {
          width: 41px;
          height: 41px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.05);
          color: #e2e8f0;
          cursor: pointer;
        }

        .mobile-menu {
          position: absolute;
          top: calc(67px + env(safe-area-inset-top));
          right: 14px;
          width: 220px;
          padding: 12px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 17px;
          background: rgba(15, 23, 42, 0.98);
          box-shadow: 0 24px 65px rgba(0, 0, 0, 0.35);
        }

        .mobile-user {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 7px 8px 12px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        }

        .mobile-user strong {
          font-size: 13px;
        }

        .mobile-user span {
          color: #94a3b8;
          font-size: 11px;
          text-transform: capitalize;
        }

        .mobile-menu button {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 8px;
          padding: 11px 10px;
          border: 0;
          border-radius: 11px;
          background: transparent;
          color: #fca5a5;
          font-family: inherit;
          font-size: 12px;
          font-weight: 750;
          cursor: pointer;
        }

        .mobile-chat {
          position: relative;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding-bottom: env(safe-area-inset-bottom);
        }

        .mobile-image-preview {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: calc(94px + env(safe-area-inset-bottom));
          z-index: 45;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 11px 13px;
          border: 1px solid rgba(96, 165, 250, 0.2);
          border-radius: 15px;
          background: rgba(15, 23, 42, 0.96);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.25);
          backdrop-filter: blur(18px);
        }

        .mobile-image-preview div {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .mobile-image-preview small {
          color: #64748b;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.12em;
        }

        .mobile-image-preview strong {
          overflow: hidden;
          color: #e2e8f0;
          font-size: 11px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mobile-image-preview button {
          flex-shrink: 0;
          padding: 8px 11px;
          border: 1px solid rgba(239, 68, 68, 0.22);
          border-radius: 10px;
          background: rgba(127, 29, 29, 0.2);
          color: #fca5a5;
          font-family: inherit;
          font-size: 10px;
          font-weight: 800;
        }
      `}</style>
    </main>
  );
}
