"use client";

import { createClient } from "@/lib/supabase/client";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./eosApp.css";

import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import ChatView from "../components/ChatView";
import BriefingView from "../components/BriefingView";
import DashboardView from "../components/DashboardView";
import NegocioView, { type Pestania, type SeccionNegocio } from "../components/NegocioView";
import CRMView from "../components/CRMView";
import CalendarioView from "../components/CalendarioView";
import GastosView, { type SeccionPersonal, type Subarea } from "../components/GastosView";
import FijosView from "../components/FijosView";
import MemoriaView from "../components/MemoriaView";
import AjustesNegocio from "../components/AjustesNegocio";
import { ProveedorEspacio } from "../components/EspacioContext";
import type { OpcionEspacio } from "../components/Sidebar";
import {
  MENU_PERSONAL,
  destinoDesdeUrl,
  espacioDe,
  inicioDe,
  menuComun,
  menuNegocio,
  nombreDeDestino,
  type Destino,
  type Espacio,
  type FuncionOcultable,
} from "../components/espacios";
import ProfileView from "../components/ProfileView";

import { useTema } from "../components/useTema";
import { useBriefing } from "../hooks/useBriefing";
import { tieneTituloPorDefecto, useConversations } from "../hooks/useConversations";
import { useChat } from "../hooks/useChat";
import { useBusquedaChats } from "../hooks/useBusquedaChats";

import AmbientBackground from "@/components/effects/AmbientBackground";
import { appTechCanvas } from "@/components/effects/techCanvasPresets";

import { revisarAdjuntos } from "@/lib/eos/adjuntos";
import { convertirArchivoABase64 } from "../services/uploads";
import { textoParaCompartir } from "../services/supabaseChat";
import type { ArchivoAdjunto } from "../types/chat";

function formatearTamanio(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";

  const unidades = ["B", "KB", "MB", "GB"];
  const indice = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1);

  const valor = bytes / 1024 ** indice;
  const decimales = indice === 0 || valor >= 10 ? 0 : 1;

  return `${valor.toFixed(decimales)} ${unidades[indice]}`;
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

/**
 * Con qué pantalla abrir, si el link que trajo hasta acá lo pedía.
 *
 * El correo del briefing diario apunta a `/eos/chat?vista=briefing`: sin
 * esto, la persona caía siempre en el chat y tenía que ir a buscar la
 * pestaña ella misma, aunque el correo la haya traído justo para verla. Los
 * nombres de antes de los espacios (gastos, negocio, crm…) siguen andando:
 * ver `destinoDesdeUrl`.
 */
function destinoInicialDesdeUrl(): Destino {
  if (typeof window === "undefined") return "chat";
  return destinoDesdeUrl(new URLSearchParams(window.location.search).get("vista")) ?? "chat";
}

/** El último espacio usado en este dispositivo, para volver a él. */
const CLAVE_ESPACIO = "eos-espacio";

function espacioInicial(destino: Destino): Espacio {
  const delDestino = espacioDe(destino);
  if (delDestino) return delDestino;
  try {
    const guardado = window.localStorage.getItem(CLAVE_ESPACIO);
    if (guardado === "personal" || guardado === "negocio") return guardado;
  } catch {
    // Sin almacenamiento (modo privado): se arranca en el negocio.
  }
  return "negocio";
}

type Empresa = {
  id: string;
  nombre: string;
  rol: string;
  activa: boolean;
  funciones_ocultas: FuncionOcultable[];
};

const SECCION_DE_DESTINO: Partial<Record<Destino, SeccionPersonal>> = {
  "p-inicio": "hoy",
  "p-mes": "mes",
  "p-viene": "viene",
  "p-tengo": "tengo",
  "p-metas": "metas",
  "p-informes": "informes",
  "p-ajustes": "ajustes",
};
const DESTINO_DE_SECCION: Record<SeccionPersonal, Destino> = {
  hoy: "p-inicio",
  mes: "p-mes",
  viene: "p-viene",
  tengo: "p-tengo",
  metas: "p-metas",
  informes: "p-informes",
  ajustes: "p-ajustes",
};
const VISTA_NEGOCIO: Partial<Record<Destino, "resumen" | SeccionNegocio>> = {
  "n-resumen": "resumen",
  "n-ventas": "vender",
  "n-compras": "comprar",
  "n-catalogo": "catalogo",
  "n-numeros": "numeros",
};
const DESTINO_DE_NEGOCIO: Record<SeccionNegocio, Destino> = {
  vender: "n-ventas",
  comprar: "n-compras",
  catalogo: "n-catalogo",
  numeros: "n-numeros",
  ajustes: "n-ajustes",
};

export default function EOSPage() {
  const [nombre, setNombre] = useState("Usuario");
  // El rubro que eligió al empezar: da ejemplos suyos en el chat vacío.
  const [rubro, setRubro] = useState<string | null>(null);
  const [plan, setPlan] = useState("free");
  const [email, setEmail] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [usuarioCargado, setUsuarioCargado] = useState(false);
  const [destino, setDestinoCrudo] = useState<Destino>(destinoInicialDesdeUrl);
  const [espacio, setEspacio] = useState<Espacio>(() => espacioInicial(destinoInicialDesdeUrl()));
  /** La parte que abrir primero al llegar a una sección desde otra (p. ej. "¿Cómo estoy?"). */
  const [subInicial, setSubInicial] = useState<string | undefined>(undefined);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [puedoAdministrar, setPuedoAdministrar] = useState(false);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [fijosPendientes, setFijosPendientes] = useState(0);
  const [busqueda, setBusqueda] = useState("");

  const [sidebarColapsado, setSidebarColapsado] = useState(false);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const botonMenuMovilRef = useRef<HTMLButtonElement | null>(null);

  const chatRef = useRef<HTMLDivElement | null>(null);

  const tema = useTema();

  const {
    briefingVisible,
    history: briefingHistory,
    scoreHistory,
    scoreSeries,
    scoreDiagnostico,
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
    mejorarTitulo,
    renombrar,
    archivar,
    eliminar,
  } = useConversations();

  const { mensaje, setMensaje, cargando, fase, archivosAdjuntos, setArchivosAdjuntos, cita, setCita, enviarMensaje, regenerarRespuesta } = useChat({
    usuarioId,
    nombre,
    plan,
    conversacionId,
    historial,
    setHistorial,
    nuevaConversacion,
    actualizarTituloSiHaceFalta,
    cargarBriefing,
    alResponder: (id) => void mejorarTitulo(id),
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
    setRubro(typeof user.user_metadata?.rubro === "string" ? user.user_metadata.rubro : null);
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
    irA("chat");
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

    // El campo no se llena solo: lo que se escribe es de la persona. Si manda
    // las fotos sin texto, `useChat` completa el pedido para EOS y la burbuja
    // muestra solo las fotos.
    setArchivosAdjuntos(juntos);
  }

  async function manejarAbrirConversacion(id: string) {
    await abrirConversacion(id);
    irA("chat");
    setMenuMovilAbierto(false);
  }

  /*
   * Ir a un lugar del menú.
   *
   * El lugar queda en la dirección (`?vista=`) sin recargar: así, al
   * refrescar o al volver a abrir la app instalada, la persona sigue donde
   * estaba. Si el lugar es de un espacio, ese espacio pasa a ser el activo.
   */
  const irA = useCallback((nuevo: Destino, sub?: string) => {
    setDestinoCrudo(nuevo);
    setSubInicial(sub);
    setMenuMovilAbierto(false);
    setSelectorAbierto(false);

    const suyo = espacioDe(nuevo);
    if (suyo) {
      setEspacio(suyo);
      try {
        window.localStorage.setItem(CLAVE_ESPACIO, suyo);
      } catch {
        // Sin almacenamiento: no pasa nada, solo no se recuerda.
      }
    }

    try {
      const url = new URL(window.location.href);
      if (nuevo === "chat") url.searchParams.delete("vista");
      else url.searchParams.set("vista", nuevo);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Algunas vistas embebidas no dejan tocar la dirección.
    }
  }, []);

  const cargarEmpresas = useCallback(async () => {
    try {
      const r = await fetch("/api/empresa", { cache: "no-store" });
      if (!r.ok) return;
      const datos = await r.json();
      setEmpresas((datos?.empresas ?? []) as Empresa[]);
      setPuedoAdministrar(datos?.puedo_administrar === true);
    } catch {
      // Sin la lista, el selector muestra "Mi negocio" y todo lo demás sigue andando.
    }
  }, []);

  useEffect(() => {
    if (!usuarioCargado) return;
    const timeout = window.setTimeout(() => void cargarEmpresas(), 0);
    return () => window.clearTimeout(timeout);
  }, [usuarioCargado, cargarEmpresas]);

  const empresaActiva = empresas.find((e) => e.activa) ?? empresas[0] ?? null;
  const funcionesOcultas = useMemo(() => empresaActiva?.funciones_ocultas ?? [], [empresaActiva]);

  /*
   * Si el negocio apagó el catálogo o los clientes y alguien llega por un
   * enlace viejo a esa sección, va al resumen en vez de a una pantalla que el
   * menú no muestra.
   */
  useEffect(() => {
    if (
      (destino === "n-catalogo" && funcionesOcultas.includes("catalogo")) ||
      (destino === "n-clientes" && funcionesOcultas.includes("clientes"))
    ) {
      irA("n-resumen");
    }
  }, [destino, funcionesOcultas, irA]);

  /** Cuántos fijos del espacio activo vencieron o están por vencer sin registrar. Va en rojo en el menú. */
  useEffect(() => {
    if (!usuarioCargado) return;
    let vigente = true;
    fetch(`/api/finanzas/fijos?ambito=${espacio}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((datos) => {
        if (!vigente || !datos) return;
        const lista = (datos.fijos ?? []) as { estado?: { estado?: string } }[];
        setFijosPendientes(lista.filter((f) => f.estado?.estado === "vencido").length);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [usuarioCargado, espacio, destino]);

  const primerNombre = nombre.trim().split(/\s+/)[0] || "Personal";

  const opcionesEspacio: OpcionEspacio[] = useMemo(
    () => [
      { clave: "personal", espacio: "personal", nombre: primerNombre, detalle: "Tus finanzas personales" },
      ...(empresas.length > 0
        ? empresas.map((e) => ({
            clave: e.id,
            espacio: "negocio" as const,
            nombre: e.nombre,
            detalle: e.rol === "propietario" ? "Tu negocio" : `Te invitaron · ${e.rol.replace("_", " ")}`,
          }))
        : [{ clave: "negocio", espacio: "negocio" as const, nombre: "Mi negocio", detalle: "Tu negocio" }]),
    ],
    [primerNombre, empresas],
  );

  const claveEspacioActivo = espacio === "personal" ? "personal" : (empresaActiva?.id ?? "negocio");
  const nombreEspacio = espacio === "personal" ? primerNombre : (empresaActiva?.nombre ?? "Mi negocio");

  async function elegirEspacio(opcion: OpcionEspacio) {
    if (opcion.espacio === "negocio" && empresaActiva && opcion.clave !== empresaActiva.id) {
      /*
       * Otro negocio: se cambia la empresa activa en el servidor (v114), que
       * es la que filtran ventas, compras, catálogo y clientes. Si falla, no
       * se cambia de espacio: mostrar el menú de un negocio con los datos de
       * otro sería peor que quedarse donde estaba.
       */
      try {
        const r = await fetch("/api/empresa", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ empresa_id: opcion.clave }),
        });
        if (!r.ok) throw new Error();
        await cargarEmpresas();
      } catch {
        window.alert("No pudimos cambiar de negocio. Probá de nuevo.");
        return;
      }
    }
    irA(inicioDe(opcion.espacio));
  }

  const itemsMenu = [
    ...(espacio === "personal" ? MENU_PERSONAL : menuNegocio(funcionesOcultas)),
    ...menuComun(espacio),
  ];
  const avisosMenu: Partial<Record<Destino, number>> =
    fijosPendientes > 0 ? { [espacio === "personal" ? "p-fijos" : "n-fijos"]: fijosPendientes } : {};

  function quitarArchivoAdjunto(indice: number) {
    setArchivosAdjuntos(archivosAdjuntos.filter((_, i) => i !== indice));
  }

  const { coincidencias, buscando } = useBusquedaChats(usuarioId, busqueda);

  const sidebarProps = {
    nombre,
    plan,
    destino,
    espacio,
    itemsMenu,
    avisos: avisosMenu,
    opcionesEspacio,
    claveEspacioActivo,
    onElegirEspacio: (o: OpcionEspacio) => void elegirEspacio(o),
    selectorAbierto,
    onSelectorAbierto: setSelectorAbierto,
    busqueda,
    coincidencias,
    buscando,
    conversacionId,
    conversaciones,
    colapsado: sidebarColapsado,
    onToggleColapsado: () => setSidebarColapsado((v) => !v),
    onDestino: (d: Destino) => irA(d),
    onBusquedaChange: setBusqueda,
    onNuevoChat: manejarNuevoChat,
    onAbrirConversacion: manejarAbrirConversacion,
    onRenombrar: renombrar,
    onArchivar: (id: string, archivarlo: boolean) => archivar(id, archivarlo, usuarioId),
    onEliminar: (id: string) => eliminar(id, usuarioId),
    onTextoParaCompartir: textoParaCompartir,
  };

  return (
    <ProveedorEspacio value={{ espacio, nombre: nombreEspacio }}>
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
        <TopBar
          tema={tema}
          pantalla={nombreDeDestino(destino, espacio)}
          espacio={{ nombre: nombreEspacio, tipo: espacio }}
          onAbrirEspacios={() => {
            setMenuMovilAbierto(true);
            setSelectorAbierto(true);
          }}
        />

        {destino === "chat" && (
          <ChatView
            historial={historial}
            nombre={nombre}
            mensaje={mensaje}
            cargando={cargando}
            fase={fase}
            archivosAdjuntos={archivosAdjuntos}
            cita={cita}
            onCitaChange={setCita}
            chatRef={chatRef}
            onMensajeChange={setMensaje}
            onEnviar={(texto) => enviarMensaje(texto)}
            onArchivosSeleccionados={manejarArchivos}
            onQuitarArchivo={quitarArchivoAdjunto}
            obtenerEtiquetaArchivo={obtenerEtiquetaArchivo}
            formatearTamanio={formatearTamanio}
            onRegenerar={regenerarRespuesta}
            cuentaNueva={conversaciones.length > 0 && conversaciones.every(tieneTituloPorDefecto)}
            rubro={rubro}
          />
        )}

        {destino === "briefing" && (
          <BriefingView
            briefing={briefingVisible}
            loading={briefingLoading}
            refreshing={briefingRefreshing}
            error={briefingError}
            isStale={briefingIsStale}
            historyCount={briefingHistory.length}
            onRefresh={refreshBriefing}
            onGoToDecisions={() => irA("memoria")}
          />
        )}

        {destino !== "chat" && destino !== "briefing" && destino !== "perfil" && !usuarioCargado && (
          <div className="neg-loading" role="status">
            <span /> Cargando…
          </div>
        )}

        {usuarioCargado && SECCION_DE_DESTINO[destino] && (
          <GastosView
            key={destino}
            seccion={SECCION_DE_DESTINO[destino]}
            subInicial={subInicial as Subarea | undefined}
            onNavegar={(seccion, sub) => irA(DESTINO_DE_SECCION[seccion], sub)}
            onOpenChat={() => irA("chat")}
          />
        )}

        {usuarioCargado && destino === "p-fijos" && <FijosView key="fijos-personal" ambito="personal" />}
        {usuarioCargado && destino === "n-fijos" && <FijosView key="fijos-negocio" ambito="negocio" />}

        {usuarioCargado && VISTA_NEGOCIO[destino] && (
          <NegocioView
            key={`${destino}-${empresaActiva?.id ?? ""}`}
            vista={VISTA_NEGOCIO[destino]}
            subInicial={subInicial as Pestania | undefined}
            onNavegar={(seccion, sub) => irA(DESTINO_DE_NEGOCIO[seccion], sub)}
            sinCatalogo={funcionesOcultas.includes("catalogo")}
            onOpenChat={() => irA("chat")}
            onOpenCRM={funcionesOcultas.includes("clientes") ? undefined : () => irA("n-clientes")}
            onDecirleAEOS={(texto) => {
              irA("chat");
              if (cargando) setMensaje(texto);
              else void enviarMensaje(texto);
            }}
            indicadores={
              /*
               * Lo que era Dashboard: hallazgos, indicadores y el puntaje.
               * Vive en Números (y en el Resumen de quien no tiene el
               * módulo de gestión), mostrado tal cual.
               */
              <div className="incrustado">
                <DashboardView
                  key={`${usuarioId}-${nombre}`}
                  briefing={briefingVisible}
                  briefingHistory={briefingHistory}
                  scoreHistory={scoreHistory}
                  scoreSeries={scoreSeries}
                  scoreDiagnostico={scoreDiagnostico}
                  plan={plan}
                  totalConversations={conversaciones.length}
                  totalMessages={historial.length}
                  onOpenChat={() => irA("chat")}
                />
              </div>
            }
          />
        )}

        {usuarioCargado && destino === "n-clientes" && (
          <CRMView key={empresaActiva?.id ?? "crm"} onOpenChat={() => irA("chat")} />
        )}

        {usuarioCargado && destino === "n-ajustes" && (
          <AjustesNegocio
            empresaId={empresaActiva?.id ?? null}
            funcionesOcultas={funcionesOcultas}
            puedoAdministrar={puedoAdministrar}
            onFuncionesCambiadas={(ocultas) =>
              setEmpresas((lista) =>
                lista.map((e) => (e.id === empresaActiva?.id ? { ...e, funciones_ocultas: ocultas } : e)),
              )
            }
          />
        )}

        {usuarioCargado && destino === "memoria" && <MemoriaView />}

        {usuarioCargado && destino === "calendario" && <CalendarioView onOpenChat={() => irA("chat")} />}

        {destino === "perfil" && (
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
    </ProveedorEspacio>
  );
}
