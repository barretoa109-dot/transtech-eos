"use client";

import { createClient } from "@/lib/supabase/client";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import "./eosApp.css";

import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import ChatView from "../components/ChatView";
import BriefingView from "../components/BriefingView";
import DashboardView from "../components/DashboardView";
import NegocioView from "../components/NegocioView";
import GastosView from "../components/GastosView";
import ProfileView from "../components/ProfileView";
import DecisionsView from "../components/DecisionsView";
import LearningsView from "../components/LearningsView";

import { useTema } from "../components/useTema";
import { useBriefing } from "../hooks/useBriefing";
import { useConversations } from "../hooks/useConversations";
import { useChat } from "../hooks/useChat";

import AmbientBackground from "@/components/effects/AmbientBackground";
import { appTechCanvas } from "@/components/effects/techCanvasPresets";

import { revisarAdjuntos, textoPorDefecto } from "@/lib/eos/adjuntos";
import { convertirArchivoABase64 } from "../services/uploads";
import type { ArchivoAdjunto, VistaEOS } from "../types/chat";

function formatearTamanio(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";

  const unidades = ["B", "KB", "MB", "GB"];
  const indice = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1);

  const valor = bytes / 1024 ** indice;
  const decimales = indice === 0 || valor >= 10 ? 0 : 1;

  return `${valor.toFixed(decimales)} ${unidades[indice]}`;
}

/**
 * ¿Este texto lo escribió el producto o la persona?
 *
 * Solo el que escribió el producto se puede pisar cuando cambian los adjuntos.
 * Si alguien tipeó "cuánto suma esto" y después agrega otra foto, ese texto no
 * se toca: reemplazarlo por "Analizá estas 3 imágenes" le borraría la pregunta.
 */
function esTextoPorDefecto(texto: string): boolean {
  return /^Analizá (esta imagen|este archivo|estas \d+ imágenes|estos \d+ archivos)\b/.test(texto.trim());
}

function obtenerEtiquetaArchivo(archivo: ArchivoAdjunto): string {
  const tipo = archivo.tipo.toLowerCase();
  const extension = archivo.extension || archivo.nombre.split(".").pop()?.toLowerCase() || "";

  if (tipo.startsWith("image/")) return "IMAGEN";
  if (tipo === "application/pdf" || extension === "pdf") return "PDF";
  if (tipo.includes("word") || ["doc", "docx"].includes(extension)) return "WORD";
  if (tipo.includes("excel") || tipo.includes("spreadsheet") || ["xls", "xlsx"].includes(extension)) return "EXCEL";
  if (tipo === "text/csv" || extension === "csv") return "CSV";
  if (tipo === "text/plain" || extension === "txt") return "TXT";

  return extension ? extension.toUpperCase() : "ARCHIVO";
}

const VISTAS_VALIDAS: VistaEOS[] = [
  "chat",
  "briefing",
  "decisions",
  "learnings",
  "dashboard",
  "negocio",
  "gastos",
  "perfil",
];

/**
 * Con qué pestaña abrir, si el link que trajo hasta acá lo pedía.
 *
 * El correo del briefing diario apunta a `/eos/chat?vista=briefing`: sin
 * esto, la persona caía siempre en el chat y tenía que ir a buscar la
 * pestaña ella misma, aunque el correo la haya traído justo para verla.
 */
function vistaInicialDesdeUrl(): VistaEOS {
  if (typeof window === "undefined") return "chat";

  const pedida = new URLSearchParams(window.location.search).get("vista");
  return VISTAS_VALIDAS.includes(pedida as VistaEOS) ? (pedida as VistaEOS) : "chat";
}

export default function EOSPage() {
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [email, setEmail] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [usuarioCargado, setUsuarioCargado] = useState(false);
  const [vista, setVista] = useState<VistaEOS>(vistaInicialDesdeUrl);
  const [busqueda, setBusqueda] = useState("");

  const [sidebarColapsado, setSidebarColapsado] = useState(false);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const botonMenuMovilRef = useRef<HTMLButtonElement | null>(null);

  const chatRef = useRef<HTMLDivElement | null>(null);

  const tema = useTema();

  const {
    briefingVisible,
    history: briefingHistory,
    isStale: briefingIsStale,
    loading: briefingLoading,
    refreshing: briefingRefreshing,
    error: briefingError,
    cargarBriefing,
    refresh: refreshBriefing,
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
  } = useConversations();

  const { mensaje, setMensaje, cargando, archivosAdjuntos, setArchivosAdjuntos, enviarMensaje, regenerarRespuesta } = useChat({
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
      .select("nombre, plan, email")
      .eq("id", user.id)
      .maybeSingle();

    const nombreUsuario = usuario?.nombre ?? user.user_metadata?.nombre ?? user.email?.split("@")[0] ?? "Usuario";

    const planUsuario = usuario?.plan ?? "free";

    setUsuarioId(user.id);
    setNombre(nombreUsuario);
    setPlan(planUsuario);
    setEmail(usuario?.email ?? user.email ?? "");
    setUsuarioCargado(true);

    await cargarBriefing(user.id);
    await cargarConversaciones(user.id);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void iniciarEOS(), 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }, 100);

    return () => window.clearTimeout(timeout);
  }, [historial]);

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

  /*
   * Escape cierra el cajón, y el foco vuelve al botón que lo abrió.
   *
   * Sin esto, alguien que navega solo con teclado y abre el menú en el
   * celular no tiene forma de cerrarlo salvo tabular hasta encontrar un
   * ítem de navegación — el overlay solo responde al clic del mouse.
   */
  useEffect(() => {
    if (!menuMovilAbierto) return;

    function alPresionarTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        setMenuMovilAbierto(false);
        botonMenuMovilRef.current?.focus();
      }
    }

    document.addEventListener("keydown", alPresionarTecla);
    return () => document.removeEventListener("keydown", alPresionarTecla);
  }, [menuMovilAbierto]);

  async function manejarNuevoChat() {
    if (!usuarioId) return;

    await nuevaConversacion(usuarioId);
    setVista("chat");
    setMenuMovilAbierto(false);
  }

  /*
   * Se ACUMULAN, no se reemplazan.
   *
   * Alguien que quiere mandar seis fotos las elige de a tandas: tres del
   * carrete, después la que sacó recién. Si cada selección pisara la anterior,
   * el segundo toque le borraría las tres primeras sin decir nada.
   */
  async function manejarArchivos(files: File[]) {
    const nuevos: ArchivoAdjunto[] = [];

    for (const file of files) {
      try {
        nuevos.push(await convertirArchivoABase64(file));
      } catch (error) {
        console.error("No se pudo cargar el archivo:", error);
        window.alert(error instanceof Error ? error.message : "No se pudo cargar el archivo.");
      }
    }

    if (nuevos.length === 0) return;

    const juntos = [...archivosAdjuntos, ...nuevos];
    const rechazo = revisarAdjuntos(juntos);

    if (rechazo) {
      window.alert(rechazo.motivo);
      return;
    }

    setArchivosAdjuntos(juntos);

    // El texto por defecto se reescribe con el total, no con lo último: si
    // decía "Analizá esta imagen: a.jpg" y ahora hay tres, tiene que decir tres.
    if (!mensaje.trim() || esTextoPorDefecto(mensaje)) {
      setMensaje(textoPorDefecto(juntos));
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

  function quitarArchivoAdjunto(indice: number) {
    const quedan = archivosAdjuntos.filter((_, i) => i !== indice);
    setArchivosAdjuntos(quedan);

    if (esTextoPorDefecto(mensaje)) {
      setMensaje(textoPorDefecto(quedan));
    }
  }

  const sidebarProps = {
    nombre,
    plan,
    vista,
    busqueda,
    conversacionId,
    conversaciones,
    colapsado: sidebarColapsado,
    onToggleColapsado: () => setSidebarColapsado((v) => !v),
    onVistaChange: manejarCambioVista,
    onBusquedaChange: setBusqueda,
    onNuevoChat: manejarNuevoChat,
    onAbrirConversacion: manejarAbrirConversacion,
  };

  return (
    <div className="eos-app" data-eos-theme={tema.aplicado === "oscuro" ? "dark" : "light"}>
      <AmbientBackground techConfig={appTechCanvas} spanCount={3} />

      <div className={`eos-sidebar ${sidebarColapsado ? "collapsed" : ""} ${menuMovilAbierto ? "mobile-open" : ""}`}>
        <Sidebar {...sidebarProps} />
      </div>

      <div
        className={`mobile-overlay ${menuMovilAbierto ? "open" : ""}`}
        onClick={() => {
          setMenuMovilAbierto(false);
          botonMenuMovilRef.current?.focus();
        }}
        aria-hidden
      />

      <button
        type="button"
        ref={botonMenuMovilRef}
        className="mobile-menu-button"
        onClick={() => setMenuMovilAbierto(true)}
        aria-label="Abrir menú"
      >
        <Menu size={20} />
      </button>

      <div className="main">
        <TopBar tema={tema} />

        {vista === "chat" && (
          <ChatView
            historial={historial}
            nombre={nombre}
            mensaje={mensaje}
            cargando={cargando}
            archivosAdjuntos={archivosAdjuntos}
            chatRef={chatRef}
            onMensajeChange={setMensaje}
            onEnviar={(texto) => enviarMensaje(texto)}
            onArchivosSeleccionados={manejarArchivos}
            onQuitarArchivo={quitarArchivoAdjunto}
            obtenerEtiquetaArchivo={obtenerEtiquetaArchivo}
            formatearTamanio={formatearTamanio}
            onRegenerar={regenerarRespuesta}
          />
        )}

        {vista === "briefing" && (
          <BriefingView
            briefing={briefingVisible}
            loading={briefingLoading}
            refreshing={briefingRefreshing}
            error={briefingError}
            isStale={briefingIsStale}
            historyCount={briefingHistory.length}
            onRefresh={refreshBriefing}
            onGoToDecisions={() => setVista("decisions")}
          />
        )}

        {["dashboard", "negocio", "gastos", "decisions", "learnings"].includes(vista) &&
          !usuarioCargado && (
            <div className="neg-loading" role="status">
              <span /> Cargando…
            </div>
          )}

        {vista === "dashboard" && usuarioCargado && (
          <DashboardView
            key={`${usuarioId}-${nombre}`}
            briefing={briefingVisible}
            briefingHistory={briefingHistory}
            plan={plan}
            totalConversations={conversaciones.length}
            totalMessages={historial.length}
            onOpenChat={() => setVista("chat")}
          />
        )}

        {vista === "negocio" && usuarioCargado && <NegocioView />}
        {vista === "gastos" && usuarioCargado && <GastosView />}

        {vista === "decisions" && usuarioCargado && <DecisionsView />}

        {vista === "learnings" && usuarioCargado && <LearningsView />}

        {vista === "perfil" && (
          <ProfileView
            nombre={nombre}
            plan={plan}
            email={email}
            usuarioId={usuarioId}
            conversaciones={conversaciones.length}
            mensajes={historial.length}
          />
        )}
      </div>
    </div>
  );
}
