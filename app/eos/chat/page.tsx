"use client";

import { createClient } from "@/lib/supabase/client";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import ChatView from "../components/ChatView";
import Composer from "../components/Composer";
import BriefingView from "../components/BriefingView";
import DashboardView from "../components/DashboardView";
import ProfileView from "../components/ProfileView";

import { useBriefing } from "../hooks/useBriefing";
import { useConversations } from "../hooks/useConversations";
import { useChat } from "../hooks/useChat";

import { convertirImagenABase64 } from "../services/uploads";
import type { VistaEOS } from "../types/chat";

export default function EOSPage() {
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [usuarioId, setUsuarioId] = useState("");
  const [usuarioCargado, setUsuarioCargado] = useState(false);
  const [vista, setVista] = useState<VistaEOS>("chat");
  const [busqueda, setBusqueda] = useState("");

  // Solo se utiliza en móviles.
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

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
    iniciarEOS();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      chatRef.current?.scrollTo({
        top: chatRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 100);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [historial]);

  // Evita que el fondo se desplace cuando el menú móvil está abierto.
  useEffect(() => {
    if (!menuMovilAbierto) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuMovilAbierto]);

  async function iniciarEOS() {
    const supabase = createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      window.location.replace("/login");
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
  }

  async function manejarNuevoChat() {
    if (!usuarioId) return;

    await nuevaConversacion(usuarioId);
    setVista("chat");
    setMenuMovilAbierto(false);
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

  async function manejarAbrirConversacion(id: string) {
    await abrirConversacion(id);
    setVista("chat");
    setMenuMovilAbierto(false);
  }

  function manejarCambioVista(nuevaVista: VistaEOS) {
    setVista(nuevaVista);
    setMenuMovilAbierto(false);
  }

  function quitarImagenAdjunta() {
    setImagenAdjunta(null);

    if (mensaje.startsWith("Analizá esta imagen:")) {
      setMensaje("");
    }
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
    <main className="eos-page">
      {/* Sidebar normal de escritorio. */}
      <div className="eos-desktop-sidebar">
        <Sidebar {...sidebarProps} />
      </div>

      {/* Menú lateral móvil. */}
      <div
        className={`eos-mobile-overlay ${
          menuMovilAbierto ? "eos-mobile-overlay-open" : ""
        }`}
        onClick={() => setMenuMovilAbierto(false)}
        aria-hidden={!menuMovilAbierto}
      />

      <aside
        className={`eos-mobile-sidebar ${
          menuMovilAbierto ? "eos-mobile-sidebar-open" : ""
        }`}
      >
        <button
          type="button"
          className="eos-mobile-close"
          onClick={() => setMenuMovilAbierto(false)}
          aria-label="Cerrar menú"
        >
          <X size={21} />
        </button>

        <Sidebar {...sidebarProps} />
      </aside>

      <section className="eos-content">
        <TopBar />

        {/* Botón visible solamente en celular. */}
        <button
          type="button"
          className="eos-mobile-menu-button"
          onClick={() => setMenuMovilAbierto(true)}
          aria-label="Abrir menú"
        >
          <Menu size={21} />
        </button>

        <div
          className="eos-view-container"
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
              />

              {imagenAdjunta && (
                <div className="eos-image-preview-wrapper">
                  <div className="eos-image-preview">
                    <div className="eos-image-preview-info">
                      <span className="eos-image-icon">IMG</span>

                      <span className="eos-image-text">
                        <small>IMAGEN ADJUNTA</small>
                        <strong>{imagenAdjunta.nombre}</strong>
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={quitarImagenAdjunta}
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              )}

              <Composer
                mensaje={mensaje}
                cargando={cargando}
                onMensajeChange={setMensaje}
                onEnviar={() => enviarMensaje()}
                onImagenSeleccionada={manejarImagen}
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
        </div>
      </section>

      <style jsx>{`
        .eos-page {
          width: 100vw;
          height: 100dvh;
          display: grid;
          grid-template-columns:
            minmax(260px, 280px)
            minmax(0, 1fr);
          overflow: hidden;
          background: #f7faff;
          color: #071226;
          font-family: Inter, Arial, Helvetica, sans-serif;
        }

        .eos-desktop-sidebar {
          min-width: 0;
          height: 100dvh;
        }

        .eos-content {
    position: relative;
    min-width: 0;

    display: flex;
    flex-direction: column;

    min-height: 0;
    height: 100%;
          background:
            radial-gradient(
              circle at 85% 10%,
              rgba(14, 165, 233, 0.07),
              transparent 26%
            ),
            linear-gradient(
              180deg,
              #07101d 0%,
              #091524 52%,
              #07111f 100%
            );
        }

        .eos-view-container {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;

  display: flex;
  flex-direction: column;

  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #1d4ed8 transparent;
}

        .eos-mobile-sidebar,
        .eos-mobile-overlay,
        .eos-mobile-menu-button {
          display: none;
        }

        .eos-image-preview-wrapper {
          position: fixed;
          left: 280px;
          right: 0;
          bottom: 116px;
          z-index: 45;
          padding: 0 24px;
          pointer-events: none;
        }

        .eos-image-preview {
          width: min(100%, 900px);
          min-height: 62px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin: 0 auto;
          padding: 11px 14px;
          box-sizing: border-box;
          border: 1px solid rgba(37, 99, 235, 0.18);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 14px 35px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(18px);
          pointer-events: auto;
        }

        .eos-image-preview-info {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .eos-image-icon {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 11px;
          background: #eff6ff;
          color: #2563eb;
          font-size: 9px;
          font-weight: 900;
        }

        .eos-image-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .eos-image-text small {
          color: #64748b;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.13em;
        }

        .eos-image-text strong {
          overflow: hidden;
          color: #071226;
          font-size: 11px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .eos-image-preview button {
          flex-shrink: 0;
          padding: 8px 12px;
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 10px;
          background: #fef2f2;
          color: #dc2626;
          font-family: inherit;
          font-size: 9px;
          font-weight: 850;
          cursor: pointer;
        }

        @media (max-width: 760px) {
          .eos-page {
            display: block;
            height: 100dvh;
          }

          .eos-desktop-sidebar {
            display: none;
          }

          .eos-content {
  width: 100%;
  height: 100%;
  min-height: 0;
}

          .eos-mobile-menu-button {
            position: fixed;
            top: calc(14px + env(safe-area-inset-top));
            left: 14px;
            z-index: 65;
            width: 43px;
            height: 43px;
            display: grid;
            place-items: center;
            border: 1px solid rgba(148, 163, 184, 0.25);
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.95);
            color: #071226;
            box-shadow: 0 8px 25px rgba(15, 23, 42, 0.1);
            backdrop-filter: blur(18px);
            cursor: pointer;
          }

          .eos-mobile-overlay {
            position: fixed;
            inset: 0;
            z-index: 79;
            display: block;
            visibility: hidden;
            background: rgba(7, 18, 38, 0.48);
            opacity: 0;
            backdrop-filter: blur(4px);
            transition:
              opacity 220ms ease,
              visibility 220ms ease;
          }

          .eos-mobile-overlay-open {
            visibility: visible;
            opacity: 1;
          }

          .eos-mobile-sidebar {
            position: fixed;
            top: 0;
            bottom: 0;
            left: 0;
            z-index: 80;
            width: min(88vw, 330px);
            display: block;
            transform: translateX(-105%);
            background: #ffffff;
            box-shadow: 24px 0 70px rgba(7, 18, 38, 0.28);
            transition: transform 240ms ease;
          }

          .eos-mobile-sidebar-open {
            transform: translateX(0);
          }

          .eos-mobile-close {
            position: absolute;
            top: calc(12px + env(safe-area-inset-top));
            right: 12px;
            z-index: 100;
            width: 39px;
            height: 39px;
            display: grid;
            place-items: center;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.96);
            color: #071226;
            box-shadow: 0 7px 20px rgba(15, 23, 42, 0.08);
            cursor: pointer;
          }

          .eos-image-preview-wrapper {
            left: 0;
            bottom: calc(105px + env(safe-area-inset-bottom));
            padding: 0 12px;
          }

          .eos-image-preview {
            border-radius: 14px;
          }
        }
      `}</style>
    </main>
  );
}