"use client";

import { createClient } from "@/lib/supabase/client";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Sidebar from "../eos/components/Sidebar";
import ChatView from "../eos/components/ChatView";
import Composer from "../eos/components/Composer";
import BriefingView from "../eos/components/BriefingView";
import DashboardView from "../eos/components/DashboardView";
import ProfileView from "../eos/components/ProfileView";

import { useBriefing } from "../eos/hooks/useBriefing";
import { useConversations } from "../eos/hooks/useConversations";
import { useChat } from "../eos/hooks/useChat";

import { convertirImagenABase64 } from "../eos/services/uploads";
import type { VistaEOS } from "../eos/types/chat";

export default function MobileEOSPage() {
  const router = useRouter();

  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [usuarioId, setUsuarioId] = useState("");
  const [usuarioCargado, setUsuarioCargado] = useState(false);
  const [inicializando, setInicializando] = useState(true);

  const [vista, setVista] = useState<VistaEOS>("chat");
  const [busqueda, setBusqueda] = useState("");
  const [menuAbierto, setMenuAbierto] = useState(false);

  const chatRef = useRef<HTMLDivElement | null>(null);

  const { briefingVisible, cargarBriefing } = useBriefing(nombre);

  const {
    conversacionId,
    conversaciones,
    historial,
    setHistorial,
    cargarConversaciones,
    nuevaConversacion,
    abrirConversacion,
    actualizarTituloSiHaceFalta,
  } = useConversations(nombre);

  const {
    mensaje,
    setMensaje,
    cargando,
    pensando,
    imagenAdjunta,
    setImagenAdjunta,
    enviarMensaje,
    regenerarRespuesta,
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

  useEffect(() => {
    document.body.style.overflow = menuAbierto ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuAbierto]);

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
    setUsuarioCargado(true);

    await cargarBriefing(user.id);
    await cargarConversaciones(user.id, nombreUsuario);

    setInicializando(false);
  }

  async function manejarNuevoChat() {
    if (!usuarioId) return;

    await nuevaConversacion(usuarioId);
    setVista("chat");
    setMenuAbierto(false);
  }

  async function manejarAbrirConversacion(id: string) {
    await abrirConversacion(id);
    setVista("chat");
    setMenuAbierto(false);
  }

  function manejarCambioVista(nuevaVista: VistaEOS) {
    setVista(nuevaVista);
    setMenuAbierto(false);
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
              radial-gradient(
                circle at 50% 10%,
                rgba(37, 99, 235, 0.18),
                transparent 34%
              ),
              linear-gradient(
                180deg,
                #07101d 0%,
                #091524 58%,
                #07111f 100%
              );
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

  const sidebarProps = {
    nombre,
    plan,
    vista,
    busqueda,
    conversacionId,
    conversaciones,
    onVistaChange: manejarCambioVista,
    onBusquedaChange: setBusqueda,
    onNuevoChat: manejarNuevoChat,
    onAbrirConversacion: manejarAbrirConversacion,
  };

  return (
    <main className="mobile-eos">
      <button
        type="button"
        className="floating-menu-button"
        onClick={() => setMenuAbierto(true)}
        aria-label="Abrir menú lateral"
      >
        <Menu size={21} />
      </button>

      <header className="mobile-header">
        <div className="mobile-header-spacer" />

        <div className="mobile-brand">
          <span>TRANSTECH</span>
          <strong>EOS</strong>
        </div>

        <div className="mobile-header-spacer" />
      </header>

      <div
        className={`mobile-overlay ${menuAbierto ? "mobile-overlay-open" : ""}`}
        onClick={() => setMenuAbierto(false)}
        aria-hidden={!menuAbierto}
      />

      <aside
        className={`mobile-sidebar ${menuAbierto ? "mobile-sidebar-open" : ""}`}
        aria-hidden={!menuAbierto}
      >
        <button
          type="button"
          className="mobile-sidebar-close"
          onClick={() => setMenuAbierto(false)}
          aria-label="Cerrar menú"
        >
          <X size={21} />
        </button>

        <Sidebar {...sidebarProps} />
      </aside>

      <section
        className="mobile-content"
        style={{
          overflowY: vista === "chat" ? "hidden" : "auto",
        }}
      >
        {vista === "chat" && (
          <>
            <ChatView
              historial={historial}
              nombre={nombre}
              chatRef={chatRef}
              onEnviarSugerencia={(texto) => enviarMensaje(texto)}
              pensando={pensando}
              onRegenerar={regenerarRespuesta}
              regenerando={cargando}
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
              mobile
            />
          </>
        )}

        {vista === "briefing" && (
          <BriefingView briefing={briefingVisible} />
        )}

        {vista === "dashboard" && usuarioCargado && (
          <DashboardView
            key={`${usuarioId}-${nombre}`}
            userName={nombre}
            plan={plan}
            totalConversations={conversaciones.length}
            totalMessages={historial.length}
            eosScore={briefingVisible.score || 0}
            onOpenChat={() => setVista("chat")}
          />
        )}

        {vista === "perfil" && (
          <ProfileView
            nombre={nombre}
            plan={plan}
            usuarioId={usuarioId}
            conversaciones={conversaciones.length}
            mensajes={historial.length}
          />
        )}
      </section>

      <style jsx>{`
        .mobile-eos {
          width: 100vw;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background:
            radial-gradient(
              circle at 88% 3%,
              rgba(14, 165, 233, 0.08),
              transparent 28%
            ),
            linear-gradient(
              180deg,
              #07101d 0%,
              #091524 54%,
              #07111f 100%
            );
          color: white;
          font-family: Inter, Arial, Helvetica, sans-serif;
        }

        .mobile-header {
          position: relative;
          z-index: 60;
          min-height: 64px;
          display: grid;
          grid-template-columns: 44px 1fr 44px;
          align-items: center;
          padding:
            calc(8px + env(safe-area-inset-top))
            12px
            8px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.13);
          background: rgba(7, 16, 29, 0.92);
          backdrop-filter: blur(20px);
        }

        .floating-menu-button {
          position: fixed;
          top: calc(11px + env(safe-area-inset-top));
          left: 12px;
          z-index: 120;
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.96);
          color: #071226;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .floating-menu-button:active {
          transform: scale(0.96);
        }

        .mobile-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .mobile-brand span {
          color: #60a5fa;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.18em;
        }

        .mobile-brand strong {
          margin-top: 4px;
          color: #ffffff;
          font-size: 20px;
          font-weight: 950;
          letter-spacing: -0.04em;
        }

        .mobile-header-spacer {
          width: 42px;
          height: 42px;
        }

        .mobile-overlay {
          position: fixed;
          inset: 0;
          z-index: 129;
          visibility: hidden;
          background: rgba(2, 8, 23, 0.58);
          opacity: 0;
          backdrop-filter: blur(4px);
          transition:
            opacity 220ms ease,
            visibility 220ms ease;
        }

        .mobile-overlay-open {
          visibility: visible;
          opacity: 1;
        }

        .mobile-sidebar {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          z-index: 130;
          width: min(88vw, 340px);
          transform: translateX(-105%);
          background: #ffffff;
          box-shadow: 24px 0 70px rgba(0, 0, 0, 0.35);
          transition: transform 240ms ease;
        }

        .mobile-sidebar-open {
          transform: translateX(0);
        }

        .mobile-sidebar-close {
          position: absolute;
          top: calc(12px + env(safe-area-inset-top));
          right: 12px;
          z-index: 135;
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border: 1px solid #dbe3ef;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.95);
          color: #071226;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.1);
          cursor: pointer;
        }

        .mobile-content {
          position: relative;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
          padding-bottom: env(safe-area-inset-bottom);
        }

        .mobile-image-preview {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 98px;
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

        @media (min-width: 761px) {
          .mobile-eos {
            max-width: 520px;
            margin: 0 auto;
            border-left: 1px solid rgba(148, 163, 184, 0.12);
            border-right: 1px solid rgba(148, 163, 184, 0.12);
          }
        }
      `}</style>
    </main>
  );
}