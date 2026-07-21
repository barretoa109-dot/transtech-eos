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

  const {
    briefingVisible,
    cargarBriefing,
  } = useBriefing(nombre);

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
  }, []);

  useEffect(() => {
    setTimeout(() => {
      chatRef.current?.scrollTo({
        top: chatRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 100);
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

  await Promise.all([
    cargarConversaciones(user.id),
    cargarBriefing(user.id),
  ]);
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
      alert("No se pudo cargar la imagen.");
      console.log(error);
    }
  }

  async function manejarAbrirConversacion(id: string) {
    await abrirConversacion(id);
    setVista("chat");
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

        {vista === "chat" && (
          <>
            <ChatView
              historial={historial}
              nombre={nombre}
              chatRef={chatRef}
              onEnviarSugerencia={(texto) => enviarMensaje(texto)}
            />

            {imagenAdjunta && (
              <div style={styles.imagePreview}>
                <span>Imagen adjunta: {imagenAdjunta.nombre}</span>
                <button onClick={() => setImagenAdjunta(null)}>Quitar</button>
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
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: "280px 1fr",
    background: "#ffffff",
    color: "#111827",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  content: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#ffffff",
    position: "relative",
  },
  imagePreview: {
    position: "fixed",
    left: 280,
    right: 0,
    bottom: 104,
    maxWidth: 850,
    margin: "0 auto",
    background: "#ecfeff",
    border: "1px solid #bae6fd",
    color: "#075985",
    borderRadius: 14,
    padding: "10px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 14,
    fontWeight: 700,
    zIndex: 10,
  },
};