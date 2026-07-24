"use client";

import { createClient } from "@/lib/supabase/client";
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
  const [vista, setVista] = useState<VistaEOS>("chat");
  const [busqueda, setBusqueda] = useState("");

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

    await cargarBriefing(user.id);
    await cargarConversaciones(user.id, nombreUsuario);
  }

  async function manejarNuevoChat() {
    if (!usuarioId) return;

    await nuevaConversacion(usuarioId);
    setVista("chat");
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
  }

  function quitarImagenAdjunta() {
    setImagenAdjunta(null);

    if (mensaje.startsWith("Analizá esta imagen:")) {
      setMensaje("");
    }
  }

  return (
    <main style={styles.main}>
      <Sidebar
        nombre={nombre}
        plan={plan}
        vista={vista}
        busqueda={busqueda}
        conversacionId={conversacionId}
        conversaciones={conversaciones}
        onVistaChange={setVista}
        onBusquedaChange={setBusqueda}
        onNuevoChat={manejarNuevoChat}
        onAbrirConversacion={manejarAbrirConversacion}
      />

      <section style={styles.content}>
  <TopBar />

  <div
    style={{
      ...styles.viewContainer,
      overflowY: vista === "chat" ? "hidden" : "auto",
      overflowX: "hidden",
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
          <div style={styles.imagePreviewWrapper}>
            {/* vista previa */}
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

    {vista === "dashboard" && (
      <DashboardView
        score={briefingVisible.score || 0}
        conversaciones={conversaciones.length}
        mensajes={historial.length}
        plan={plan}
        ultimoChat={conversaciones[0]?.titulo}
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
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
  width: "100vw",
  height: "100vh",
  display: "grid",
  gridTemplateColumns: "minmax(260px, 280px) minmax(0, 1fr)",
  overflow: "hidden",
  background: "#f7faff",
  color: "#071226",
  fontFamily: "Inter, Arial, Helvetica, sans-serif",
},

  content: {
  position: "relative",
  minWidth: 0,
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  background:
    "radial-gradient(circle at 85% 10%, rgba(14,165,233,0.07), transparent 26%), linear-gradient(180deg, #07101d 0%, #091524 52%, #07111f 100%)",
},

  viewContainer: {
  position: "relative",
  flex: 1,
  minWidth: 0,
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarWidth: "thin",
  scrollbarColor: "#1d4ed8 transparent",
},

  imagePreviewWrapper: {
    position: "fixed",
    left: 280,
    right: 0,
    bottom: 116,
    zIndex: 40,
    padding: "0 24px",
    pointerEvents: "none",
  },

 imagePreview: {
  position: "fixed",
  left: 280,
  right: 0,
  bottom: 116,
  zIndex: 35,
  width: "calc(100% - 48px)",
  maxWidth: 900,
  margin: "0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  padding: "11px 14px",
  border: "1px solid rgba(37, 99, 235, 0.18)",
  borderRadius: 16,
  background: "rgba(239, 246, 255, 0.96)",
  color: "#1e40af",
  boxShadow: "0 14px 35px rgba(15, 23, 42, 0.08)",
  backdropFilter: "blur(18px)",
  fontSize: 12,
  fontWeight: 800,
},

  imagePreviewInfo: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 12,
  },

  imageIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    background: "rgba(34,211,238,0.09)",
    border: "1px solid rgba(34,211,238,0.13)",
    color: "#67e8f9",
    fontSize: 16,
    fontWeight: 900,
  },

  imageTextContent: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  imageLabel: {
    color: "#648198",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.13em",
  },

  imageName: {
    overflow: "hidden",
    color: "#eaf8ff",
    fontSize: 11,
    fontWeight: 800,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  removeImageButton: {
    flexShrink: 0,
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(248,113,113,0.14)",
    background: "rgba(248,113,113,0.08)",
    color: "#fca5a5",
    fontFamily: "inherit",
    fontSize: 9,
    fontWeight: 850,
    cursor: "pointer",
  },
};