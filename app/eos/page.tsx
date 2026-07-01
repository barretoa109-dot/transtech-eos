"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type Mensaje = { rol: "usuario" | "eos"; texto: string };
type Conversacion = { id: string; titulo: string | null; created_at?: string };

type Briefing = {
  saludo?: string;
  resumen?: string;
  prioridad_1?: string;
  prioridad_2?: string;
  prioridad_3?: string;
  recomendacion_principal?: string;
  score?: number;
};

type Vista = "chat" | "briefing" | "dashboard" | "perfil";

export default function EOSPage() {
  const [mensaje, setMensaje] = useState("");
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [usuarioId, setUsuarioId] = useState("");
  const [conversacionId, setConversacionId] = useState("");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [historial, setHistorial] = useState<Mensaje[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [vista, setVista] = useState<Vista>("chat");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);

  const chatRef = useRef<HTMLDivElement | null>(null);

  const briefingVisible = useMemo(() => {
    return {
      saludo: briefing?.saludo || `Hola ${nombre}.`,
      resumen:
        briefing?.resumen ||
        "EOS está listo para ayudarte. Cuando empieces a conversar, acá vas a ver un resumen inteligente de tu situación.",
      prioridad_1: briefing?.prioridad_1 || "Definir qué querés mejorar",
      prioridad_2: briefing?.prioridad_2 || "Ordenar la información",
      prioridad_3: briefing?.prioridad_3 || "Crear el próximo paso",
      recomendacion_principal:
        briefing?.recomendacion_principal ||
        "Contale a EOS qué querés lograr para que pueda ayudarte mejor.",
      score: briefing?.score || 0,
    };
  }, [briefing, nombre]);

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
    const uuid = localStorage.getItem("usuario_uuid");
    const usuarioNombre = localStorage.getItem("usuario_nombre") || "Usuario";
    const usuarioPlan = localStorage.getItem("usuario_plan") || "free";

    setNombre(usuarioNombre);
    setPlan(usuarioPlan);

    if (!uuid) {
      window.location.href = "/login";
      return;
    }

    setUsuarioId(uuid);
    await cargarConversaciones(uuid);
    await cargarBriefing(uuid);
  }

  async function cargarBriefing(uuid: string) {
    try {
      const response = await fetch(`/api/briefing?usuario_id=${uuid}`);
      const data = await response.json();
      if (data?.briefing) setBriefing(data.briefing);
    } catch (error) {
      console.log("Error cargando briefing:", error);
    }
  }

  async function cargarConversaciones(uuid: string) {
    const { data, error } = await supabase
      .from("conversaciones")
      .select("*")
      .eq("usuario_id", uuid)
      .order("created_at", { ascending: false });

    if (error) {
      console.log("Error cargando conversaciones:", error);
      return;
    }

    if (!data || data.length === 0) {
      await crearNuevaConversacion(uuid);
      return;
    }

    setConversaciones(data);
    setConversacionId(data[0].id);
    await cargarMensajes(data[0].id);
  }

  async function crearNuevaConversacion(uuid = usuarioId) {
  if (!uuid) return null;

  const { data, error } = await supabase
    .from("conversaciones")
    .insert([{ usuario_id: uuid, titulo: "Nuevo chat" }])
    .select()
    .single();

  if (error || !data) {
    console.log("Error creando conversación:", error);
    return null;
  }

  setConversacionId(data.id);
  setConversaciones((prev) => [data, ...prev]);
  setVista("chat");

  setHistorial([
    {
      rol: "eos",
      texto: `Hola ${nombre}. Soy EOS.\n\nEste es un nuevo chat. Contame qué querés trabajar hoy: finanzas, negocio, documentos, objetivos, tareas o decisiones importantes.`,
    },
  ]);

  return data.id;
}

  async function cargarMensajes(idConversacion: string) {
    const { data, error } = await supabase
      .from("mensajes")
      .select("*")
      .eq("conversacion_id", idConversacion)
      .order("created_at", { ascending: true });

    if (error) {
      console.log("Error cargando mensajes:", error);
      return;
    }

    const mensajesFormateados: Mensaje[] = (data || []).map((m: any) => ({
      rol: m.remitente === "usuario" || m.rol === "usuario" ? "usuario" : "eos",
      texto: m.mensaje || m.texto || "",
    }));

    setHistorial(mensajesFormateados);
    setVista("chat");
  }

  async function guardarMensaje(
    idConversacion: string,
    remitente: "usuario" | "eos",
    texto: string
  ) {
    if (!idConversacion || !texto.trim()) return;

    const { error } = await supabase
      .from("mensajes")
      .insert([{ conversacion_id: idConversacion, remitente, mensaje: texto }]);

    if (!error) return;

    await supabase
      .from("mensajes")
      .insert([{ conversacion_id: idConversacion, rol: remitente, texto }]);
  }

  async function actualizarTituloConversacion(idConversacion: string, textoUsuario: string) {
  const texto = textoUsuario.toLowerCase();

  let titulo = "Nueva conversación EOS";

  if (texto.includes("excel") || texto.includes("planilla") || texto.includes("archivo")) {
    titulo = "Documento profesional";
  } else if (texto.includes("finanza") || texto.includes("gasto") || texto.includes("deuda") || texto.includes("ahorro")) {
    titulo = "Plan financiero";
  } else if (texto.includes("negocio") || texto.includes("venta") || texto.includes("empresa") || texto.includes("cliente")) {
    titulo = "Estrategia de negocio";
  } else if (texto.includes("objetivo") || texto.includes("tarea") || texto.includes("organizar")) {
    titulo = "Objetivos y organización";
  } else if (texto.includes("hola") || texto.includes("buenas")) {
    titulo = "Inicio con EOS";
  } else {
    const palabras = textoUsuario
      .replace(/[¿?¡!.,]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);

    titulo = palabras.slice(0, 6).join(" ");

    if (titulo.length < 8) titulo = "Conversación EOS";
    if (titulo.length > 48) titulo = titulo.slice(0, 48) + "...";
  }

  await supabase
    .from("conversaciones")
    .update({ titulo })
    .eq("id", idConversacion);

  setConversaciones((prev) =>
    prev.map((c) => (c.id === idConversacion ? { ...c, titulo } : c))
  );
}

  function extraerTextoEOS(valor: any): string {
    if (!valor) return "";
    if (typeof valor === "string") return valor;
    if (Array.isArray(valor)) return valor.map(extraerTextoEOS).filter(Boolean).join("\n\n");

    if (typeof valor === "object") {
      return (
        extraerTextoEOS(valor.respuesta) ||
        extraerTextoEOS(valor.output) ||
        extraerTextoEOS(valor.text) ||
        extraerTextoEOS(valor.message) ||
        extraerTextoEOS(valor.content) ||
        extraerTextoEOS(valor.data) ||
        extraerTextoEOS(valor.json) ||
        extraerTextoEOS(valor.choices?.[0]?.message?.content) ||
        extraerTextoEOS(valor.response?.body?.respuesta) ||
        ""
      );
    }

    return String(valor);
  }

  function limpiarRespuesta(valor: any): string {
    let texto = extraerTextoEOS(valor);

    if (!texto || texto === "[object Object]") return "";

    try {
      const parsed = JSON.parse(texto);
      const extraido = extraerTextoEOS(parsed);
      if (extraido) texto = extraido;
    } catch {}

    return texto
      .replace(/^=/, "")
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .trim();
  }

  async function obtenerRespuesta(response: Response) {
    const texto = await response.text();
    if (!texto || texto.trim() === "") throw new Error("EOS respondió vacío");

    try {
      const data = JSON.parse(texto);
      return limpiarRespuesta(data);
    } catch {
      return limpiarRespuesta(texto);
    }
  }

  async function enviarMensaje(textoManual?: string) {
    const textoFinal = textoManual || mensaje;
    if (!textoFinal.trim() || cargando) return;

    if (!usuarioId) {
      window.location.href = "/login";
      return;
    }

    let conversacionActiva = conversacionId;

    if (!conversacionActiva) {
      const nueva = await crearNuevaConversacion(usuarioId);
      if (!nueva) return;
      conversacionActiva = nueva;
    }

    const textoUsuario = textoFinal.trim();
    const historialActual = historial;

    setMensaje("");
    setCargando(true);
    setVista("chat");

    setHistorial((prev) => [
      ...prev,
      { rol: "usuario", texto: textoUsuario },
      { rol: "eos", texto: "Analizando..." },
    ]);

    await guardarMensaje(conversacionActiva, "usuario", textoUsuario);

    const conversacionActual = conversaciones.find((c) => c.id === conversacionActiva);

    if (
      !conversacionActual?.titulo ||
      conversacionActual.titulo === "Nuevo chat" ||
      conversacionActual.titulo === "Nuevo proceso EOS" ||
      conversacionActual.titulo === "Diagnóstico actual"
    ) {
      await actualizarTituloConversacion(conversacionActiva, textoUsuario);
    }

    try {
      const response = await fetch("/api/eos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_id: usuarioId,
          conversacion_id: conversacionActiva,
          nombre,
          plan,
          mensaje: textoUsuario,
          historial: historialActual
  .filter((m) => !m.texto.includes("Este es un nuevo chat"))
  .slice(-10),
nuevo_chat: historialActual.length <= 1,
origen: "eos-web",
        }),
      });

      const respuestaLimpia = await obtenerRespuesta(response);
      if (!response.ok) throw new Error("Error en EOS");

      const respuestaFinal =
        respuestaLimpia || "Te leo. Contame un poco más para ayudarte mejor.";

      await guardarMensaje(conversacionActiva, "eos", respuestaFinal);

      setHistorial((prev) => [
        ...prev.slice(0, -1),
        { rol: "eos", texto: respuestaFinal },
      ]);

      await cargarBriefing(usuarioId);
    } catch (error) {
      console.log("ERROR EOS:", error);

      const respuestaError =
        "Ahora mismo no pude conectarme bien. Probá de nuevo en unos segundos.";

      await guardarMensaje(conversacionActiva, "eos", respuestaError);

      setHistorial((prev) => [
        ...prev.slice(0, -1),
        { rol: "eos", texto: respuestaError },
      ]);
    } finally {
      setCargando(false);
    }
  }

  function renderTexto(textoCompleto: string) {
    return textoCompleto.split("\n").map((linea, i) => {
      const texto = linea.trim();

      if (
        texto.startsWith("http://") ||
        texto.startsWith("https://") ||
        texto.startsWith("/descargar")
      ) {
        return (
          <div key={i} style={styles.downloadCard}>
            <div>
              <strong>Archivo generado</strong>
              <p>Tu documento está listo.</p>
            </div>
            <a href={texto} target="_blank" rel="noopener noreferrer" style={styles.downloadButton}>
              Descargar
            </a>
          </div>
        );
      }

      return <div key={i}>{linea}</div>;
    });
  }

  const conversacionesFiltradas = conversaciones.filter((c) =>
    (c.titulo || "Nuevo chat").toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <main style={styles.main}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={styles.brand}>
            <div style={styles.logoWrap}>
              <div style={styles.logoGlow} />
              <div style={styles.logo}>E</div>
            </div>

            <div>
              <div style={styles.brandSmall}>TransTech</div>
              <div style={styles.brandTitle}>EOS</div>
            </div>
          </div>

          <button onClick={() => crearNuevaConversacion()} style={styles.newChat}>
            + Nuevo chat
          </button>

          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar conversaciones..."
            style={styles.search}
          />

          <nav style={styles.nav}>
            <button onClick={() => setVista("chat")} style={vista === "chat" ? styles.navActive : styles.navItem}>
              Inicio
            </button>
            <button onClick={() => setVista("briefing")} style={vista === "briefing" ? styles.navActive : styles.navItem}>
              Briefing
            </button>
            <button onClick={() => setVista("dashboard")} style={vista === "dashboard" ? styles.navActive : styles.navItem}>
              Dashboard
            </button>
          </nav>
        </div>

        <div style={styles.history}>
          <p style={styles.sectionTitle}>Recientes</p>

          {conversacionesFiltradas.length === 0 && (
            <p style={styles.empty}>Todavía no hay conversaciones.</p>
          )}

          {conversacionesFiltradas.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setConversacionId(c.id);
                cargarMensajes(c.id);
              }}
              style={c.id === conversacionId ? styles.chatActive : styles.chatItem}
            >
              {c.titulo || "Nuevo chat"}
            </button>
          ))}
        </div>

        <button onClick={() => setVista("perfil")} style={styles.userBox}>
          <div style={styles.userAvatar}>{nombre.charAt(0).toUpperCase()}</div>
          <div style={styles.userText}>
            <strong>{nombre}</strong>
            <span>Plan {plan}</span>
          </div>
        </button>
      </aside>

      <section style={styles.content}>
        <header style={styles.topbar}>
          <div />
          <div style={styles.status}>
            <span style={styles.dot} />
            Activo
          </div>
        </header>

        {vista === "chat" && (
          <>
            <div ref={chatRef} style={styles.chatArea}>
              <div style={styles.chatInner}>
                {historial.length === 0 && (
                  <div style={styles.welcome}>
                    <div style={styles.eosOrb}>E</div>
                    <h2>¿Qué querés trabajar hoy?</h2>
                    <p>
                      EOS puede ayudarte con tu vida personal, negocio, documentos,
                      finanzas, objetivos y decisiones.
                    </p>

                    <div style={styles.quickGrid}>
                      {[
                        "Ordenar mis finanzas",
                        "Crear un plan para mi negocio",
                        "Generar un Excel profesional",
                        "Organizar mis objetivos",
                      ].map((accion) => (
                        <button
                          key={accion}
                          onClick={() => enviarMensaje(accion)}
                          style={styles.quickAction}
                        >
                          {accion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {historial.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      ...styles.messageRow,
                      justifyContent: item.rol === "usuario" ? "flex-end" : "flex-start",
                    }}
                  >
                    {item.rol === "eos" && <Avatar letra="E" />}

                    <div
                      style={{
                        ...styles.bubble,
                        ...(item.rol === "usuario" ? styles.userBubble : styles.eosBubble),
                      }}
                    >
                      <div style={styles.meta}>{item.rol === "usuario" ? nombre : "EOS"}</div>
                      <div style={styles.messageText}>{renderTexto(item.texto)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.inputDock}>
              <div style={styles.inputBox}>
                <button style={styles.plusButton}>+</button>

                <textarea
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviarMensaje();
                    }
                  }}
                  placeholder="Preguntale algo a EOS..."
                  rows={1}
                  style={styles.textarea}
                />

                <button onClick={() => enviarMensaje()} disabled={cargando} style={styles.send}>
                  {cargando ? "..." : "↑"}
                </button>
              </div>

              <p style={styles.note}>EOS puede cometer errores. Usalo como apoyo para decidir mejor.</p>
            </div>
          </>
        )}

        {vista === "briefing" && (
  <Panel>
    <div style={styles.panelTop}>
      <div>
        <p style={styles.eyebrow}>Briefing inteligente</p>
        <h2>{briefingVisible.saludo}</h2>
      </div>
      <div style={styles.score}>{briefingVisible.score}</div>
    </div>

    <div style={styles.briefingHero}>
      <h3>Resumen actual</h3>
      <p>{briefingVisible.resumen}</p>
    </div>

    <div style={styles.cardGrid}>
      <div style={styles.card}>
        <span>Prioridad 1</span>
        <strong>{briefingVisible.prioridad_1}</strong>
      </div>
      <div style={styles.card}>
        <span>Prioridad 2</span>
        <strong>{briefingVisible.prioridad_2}</strong>
      </div>
      <div style={styles.card}>
        <span>Prioridad 3</span>
        <strong>{briefingVisible.prioridad_3}</strong>
      </div>
    </div>

    <div style={styles.recommendation}>
      <strong>Recomendación principal</strong>
      <p>{briefingVisible.recomendacion_principal}</p>
    </div>

    <div style={styles.timelineBox}>
      <h3>Próximos pasos sugeridos</h3>
      <p>1. Contar a EOS el contexto actual.</p>
      <p>2. Definir una meta concreta.</p>
      <p>3. Pedir un plan, documento o tablero de apoyo.</p>
    </div>
  </Panel>
)}

        {vista === "dashboard" && (
  <Panel>
    <p style={styles.eyebrow}>Dashboard EOS</p>
    <h2>Centro de control</h2>
    <p style={styles.panelText}>
      Vista general del estado del usuario dentro de EOS: conversaciones, score, plan,
      actividad y próximos módulos inteligentes.
    </p>

    <div style={styles.cardGrid}>
      <div style={styles.metricCard}>
        <span>EOS Score</span>
        <strong>{briefingVisible.score || 0}</strong>
        <small>Estado inteligente</small>
      </div>
      <div style={styles.metricCard}>
        <span>Conversaciones</span>
        <strong>{conversaciones.length}</strong>
        <small>Procesos registrados</small>
      </div>
      <div style={styles.metricCard}>
        <span>Plan</span>
        <strong>{plan}</strong>
        <small>Acceso actual</small>
      </div>
    </div>

    <div style={styles.dashboardGrid}>
      <div style={styles.dashboardBlock}>
        <h3>Actividad reciente</h3>
        <p>Último chat activo: {conversaciones[0]?.titulo || "Sin actividad reciente"}</p>
        <p>Mensajes cargados: {historial.length}</p>
      </div>

      <div style={styles.dashboardBlock}>
        <h3>Capacidades activas</h3>
        <p>Chat inteligente</p>
        <p>Generación de archivos</p>
        <p>Briefing diario</p>
        <p>Historial de conversaciones</p>
      </div>
    </div>
  </Panel>
)}

        {vista === "perfil" && (
  <Panel>
    <p style={styles.eyebrow}>Perfil EOS</p>
    <h2>{nombre}</h2>

    <div style={styles.profileBox}>
      <div style={styles.bigAvatar}>{nombre.charAt(0).toUpperCase()}</div>
      <div>
        <h3>{nombre}</h3>
        <p>Plan actual: {plan}</p>
        <p>Estado: EOS activo</p>
        <p>Usuario ID: {usuarioId || "No disponible"}</p>
      </div>
    </div>

    <div style={styles.dashboardGrid}>
      <div style={styles.dashboardBlock}>
        <h3>Uso del sistema</h3>
        <p>Conversaciones: {conversaciones.length}</p>
        <p>Mensajes en chat actual: {historial.length}</p>
      </div>

      <div style={styles.dashboardBlock}>
        <h3>Funciones disponibles</h3>
        <p>Asesor EOS</p>
        <p>Briefing inteligente</p>
        <p>Documentos profesionales</p>
        <p>Dashboard básico</p>
      </div>
    </div>
  </Panel>
)}
      </section>
    </main>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div style={styles.panelPage}>{children}</div>;
}

function Avatar({ letra }: { letra: string }) {
  return <div style={styles.avatar}>{letra}</div>;
}

const styles: any = {
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
  sidebar: {
    height: "100vh",
    borderRight: "1px solid #e5e7eb",
    background: "#f7f7f8",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sidebarHeader: {
    padding: 16,
    flexShrink: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  logoWrap: {
    position: "relative",
    width: 44,
    height: 44,
  },
  logoGlow: {
    position: "absolute",
    inset: -4,
    background: "linear-gradient(135deg,#22d3ee,#0ea5e9)",
    opacity: 0.25,
    filter: "blur(10px)",
    borderRadius: 16,
  },
  logo: {
    position: "relative",
    width: 44,
    height: 44,
    borderRadius: 15,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 20,
    color: "#06202a",
    boxShadow: "0 10px 24px rgba(34,211,238,.25)",
  },
  brandSmall: {
    fontSize: 13,
    color: "#0891b2",
    fontWeight: 800,
    lineHeight: 1,
  },
  brandTitle: {
    fontSize: 29,
    fontWeight: 900,
    lineHeight: 1.05,
    letterSpacing: "-0.04em",
  },
  newChat: {
    width: "100%",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    borderRadius: 14,
    padding: "13px 14px",
    textAlign: "left",
    fontWeight: 800,
    cursor: "pointer",
    marginBottom: 10,
  },
  search: {
    width: "100%",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 14,
    padding: "13px 14px",
    outline: "none",
    marginBottom: 16,
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  nav: {
    display: "grid",
    gap: 5,
  },
  navItem: {
    border: "none",
    background: "transparent",
    color: "#374151",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 15,
  },
  navActive: {
    border: "none",
    background: "#e0f7ff",
    color: "#075985",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 15,
  },
  history: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "0 16px 16px",
  },
  sectionTitle: {
    margin: "8px 0",
    color: "#6b7280",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: ".1em",
    fontWeight: 900,
  },
  empty: {
    color: "#9ca3af",
    fontSize: 14,
  },
  chatItem: {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "#4b5563",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    marginBottom: 4,
    fontSize: 15,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatActive: {
    width: "100%",
    border: "none",
    background: "#ffffff",
    color: "#111827",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 800,
    marginBottom: 4,
    fontSize: 15,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    boxShadow: "0 8px 20px rgba(15,23,42,.05)",
  },
  userBox: {
    flexShrink: 0,
    padding: 16,
    border: "none",
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    alignItems: "center",
    gap: 11,
    background: "#f7f7f8",
    cursor: "pointer",
    textAlign: "left",
  },
  userAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    background: "#22d3ee",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    color: "#06202a",
  },
  userText: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  content: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#ffffff",
  },
  topbar: {
    height: 54,
    borderBottom: "1px solid #eeeeee",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 28px",
    flexShrink: 0,
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#15803d",
    borderRadius: 999,
    padding: "8px 13px",
    fontWeight: 700,
    fontSize: 14,
  },
  dot: {
    width: 8,
    height: 8,
    background: "#22c55e",
    borderRadius: 999,
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "28px 24px 130px",
  },
  chatInner: {
    maxWidth: 850,
    margin: "0 auto",
  },
  welcome: {
    minHeight: "65vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  },
  eosOrb: {
    width: 64,
    height: 64,
    borderRadius: 20,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 30,
    fontWeight: 900,
    marginBottom: 20,
    color: "#06202a",
  },
  quickGrid: {
    marginTop: 24,
    width: "100%",
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  },
  quickAction: {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 14,
    padding: 16,
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
  },
  messageRow: {
    display: "flex",
    gap: 12,
    marginBottom: 22,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 999,
    background: "#22d3ee",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flexShrink: 0,
    color: "#06202a",
  },
  bubble: {
    maxWidth: "78%",
    padding: "14px 16px",
    borderRadius: 18,
    lineHeight: 1.6,
  },
  eosBubble: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    color: "#111827",
  },
  userBubble: {
    background: "#dff8ff",
    color: "#083344",
    border: "1px solid #bae6fd",
  },
  meta: {
    fontSize: 12,
    opacity: 0.65,
    fontWeight: 700,
    marginBottom: 4,
  },
  messageText: {
    whiteSpace: "pre-line",
    fontSize: 15.5,
  },
  downloadCard: {
    marginTop: 12,
    background: "#ecfeff",
    border: "1px solid #bae6fd",
    borderRadius: 14,
    padding: 14,
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  downloadButton: {
    background: "#22d3ee",
    color: "#083344",
    textDecoration: "none",
    borderRadius: 999,
    padding: "9px 13px",
    fontWeight: 800,
  },
  inputDock: {
    position: "fixed",
    left: 280,
    right: 0,
    bottom: 0,
    background: "linear-gradient(to top,#ffffff 78%,rgba(255,255,255,0))",
    padding: "28px 24px 14px",
  },
  inputBox: {
    maxWidth: 850,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: 999,
    padding: 8,
    boxShadow: "0 12px 35px rgba(0,0,0,.08)",
  },
  plusButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: "none",
    background: "#f3f4f6",
    cursor: "pointer",
    fontSize: 22,
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    padding: "11px 6px",
    fontSize: 15,
    fontFamily: "Arial, Helvetica, sans-serif",
    minHeight: 42,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 999,
    border: "none",
    background: "#22d3ee",
    color: "#083344",
    fontWeight: 900,
    fontSize: 19,
    cursor: "pointer",
  },
  note: {
    textAlign: "center",
    color: "#6b7280",
    fontSize: 12,
    margin: "8px 0 0",
  },
  panelPage: {
    maxWidth: 850,
    width: "100%",
    margin: "0 auto",
    padding: "42px 24px",
    overflowY: "auto",
  },
  eyebrow: {
    margin: 0,
    color: "#0891b2",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: ".1em",
    textTransform: "uppercase",
  },
  panelTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
  },
  panelText: {
    color: "#4b5563",
    lineHeight: 1.7,
  },
  score: {
    width: 58,
    height: 58,
    borderRadius: 18,
    background: "#22d3ee",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 22,
    color: "#06202a",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
    marginTop: 20,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
    background: "#f9fafb",
    fontWeight: 700,
  },
  recommendation: {
    marginTop: 16,
    background: "#ecfeff",
    border: "1px solid #bae6fd",
    borderRadius: 14,
    padding: 16,
    color: "#075985",
    fontWeight: 700,
  },
  metricCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 18,
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  profileBox: {
    border: "1px solid #e5e7eb",
    borderRadius: 20,
    padding: 22,
    display: "flex",
    alignItems: "center",
    gap: 18,
    background: "#ffffff",
    boxShadow: "0 12px 35px rgba(0,0,0,.04)",
  },
  bigAvatar: {
    width: 70,
    height: 70,
    borderRadius: 24,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 30,
    color: "#06202a",
  },
briefingHero: {
  marginTop: 24,
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 20,
  background: "#ffffff",
  boxShadow: "0 10px 30px rgba(0,0,0,.035)",
},
timelineBox: {
  marginTop: 18,
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 20,
  background: "#f9fafb",
  lineHeight: 1.8,
},
dashboardGrid: {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 14,
  marginTop: 18,
},
dashboardBlock: {
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 20,
  background: "#ffffff",
  boxShadow: "0 10px 30px rgba(0,0,0,.035)",
  lineHeight: 1.7,
},
};