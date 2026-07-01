"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type Mensaje = {
  rol: "usuario" | "eos";
  texto: string;
};

type Conversacion = {
  id: string;
  titulo: string | null;
};

type Briefing = {
  saludo: string;
  resumen: string;
  prioridad_1: string;
  prioridad_2: string;
  prioridad_3: string;
  recomendacion_principal: string;
  score: number;
  tipo_usuario?: string;
};

export default function EOSPage() {
  const [mensaje, setMensaje] = useState("");
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [usuarioId, setUsuarioId] = useState("");
  const [conversacionId, setConversacionId] = useState("");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [historial, setHistorial] = useState<Mensaje[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [cargando, setCargando] = useState(false);
  const [briefingAbierto, setBriefingAbierto] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  const briefingVisible = useMemo<Briefing>(() => {
    return (
      briefing || {
        saludo: `Hola ${nombre}.`,
        resumen:
          "EOS está listo para ayudarte a ordenar tu vida, negocio o empresa. Cuando empieces a conversar, este panel mostrará prioridades, score, alertas y recomendaciones.",
        prioridad_1: "Definir qué querés mejorar",
        prioridad_2: "Registrar información importante",
        prioridad_3: "Crear una acción concreta",
        recomendacion_principal:
          "Contale a EOS tu situación actual para empezar a construir tu sistema inteligente.",
        score: 0,
        tipo_usuario: "general",
      }
    );
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

      if (data?.briefing) {
        setBriefing(data.briefing);
      }
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

  async function crearNuevaConversacion(uuid = usuarioId): Promise<string | null> {
    if (!uuid) return null;

    const { data, error } = await supabase
      .from("conversaciones")
      .insert([{ usuario_id: uuid, titulo: "Nuevo proceso EOS" }])
      .select()
      .single();

    if (error || !data) {
      console.log("Error creando conversación:", error);
      return null;
    }

    setConversacionId(data.id);
    setConversaciones((prev) => [data, ...prev]);
    setHistorial([]);

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
  }

  async function guardarMensaje(
    idConversacion: string,
    remitente: "usuario" | "eos",
    texto: string
  ) {
    if (!idConversacion || !texto.trim()) return;

    const { error } = await supabase.from("mensajes").insert([
      { conversacion_id: idConversacion, remitente, mensaje: texto },
    ]);

    if (!error) return;

    await supabase.from("mensajes").insert([
      { conversacion_id: idConversacion, rol: remitente, texto },
    ]);
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

  async function obtenerRespuesta(response: Response): Promise<string> {
    const texto = await response.text();

    if (!texto || texto.trim() === "") {
      throw new Error("EOS respondió vacío");
    }

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
      const nuevaConversacionId = await crearNuevaConversacion(usuarioId);
      if (!nuevaConversacionId) {
        alert("No se pudo iniciar la conversación.");
        return;
      }
      conversacionActiva = nuevaConversacionId;
    }

    const textoUsuario = textoFinal.trim();
    const historialActual = historial;

    setMensaje("");
    setCargando(true);

    setHistorial((prev) => [
      ...prev,
      { rol: "usuario", texto: textoUsuario },
      { rol: "eos", texto: "Analizando contexto, objetivos y próximos pasos..." },
    ]);

    await guardarMensaje(conversacionActiva, "usuario", textoUsuario);

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
          historial: historialActual.slice(-10),
          origen: "eos-web",
        }),
      });

      const respuestaLimpia = await obtenerRespuesta(response);

      if (!response.ok) throw new Error("Error en EOS");

      const respuestaFinal =
        respuestaLimpia || "Te leo. Contame un poco más de contexto para ayudarte mejor.";

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
              <strong>Archivo generado por EOS</strong>
              <p>Tu documento está listo para descargar.</p>
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

  const acciones = [
    "Ordenar mis finanzas personales",
    "Crear un plan para mi negocio",
    "Generar un Excel profesional",
    "Crear objetivos y tareas",
  ];

  const menuPrincipal = [
    "Inicio",
    "Chats",
    "Dashboard",
    "Briefing",
    "Objetivos",
    "Tareas",
    "KPIs",
    "Documentos",
    "Excels",
    "Finanzas",
    "Clientes",
    "Configuración",
  ];

  return (
    <main style={styles.main}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTop}>
          <div style={styles.brand}>
            <div style={styles.logo}>E</div>
            <div>
              <p style={styles.brandSmall}>TransTech</p>
              <h1 style={styles.brandTitle}>EOS</h1>
            </div>
          </div>

          <button onClick={() => crearNuevaConversacion()} style={styles.newChat}>
            ✦ Nuevo chat
          </button>

          <div style={styles.searchBox}>Buscar en EOS...</div>

          <nav style={styles.nav}>
            {menuPrincipal.map((item) => (
              <button key={item} style={styles.navItem}>
                {item}
              </button>
            ))}
          </nav>
        </div>

        <div style={styles.conversationBlock}>
          <p style={styles.sectionTitle}>Recientes</p>

          <div style={styles.conversationList}>
            {conversaciones.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setConversacionId(c.id);
                  cargarMensajes(c.id);
                }}
                style={c.id === conversacionId ? styles.conversationActive : styles.conversationItem}
              >
                {c.titulo || "Conversación EOS"}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.userBox}>
          <div style={styles.userAvatar}>{nombre.charAt(0).toUpperCase()}</div>
          <div>
            <strong>{nombre}</strong>
            <p>Plan {plan} · EOS activo</p>
          </div>
        </div>
      </aside>

      <section style={styles.content}>
        <header style={styles.topbar}>
          <div>
            <p style={styles.topLabel}>EOS OS</p>
            <h2 style={styles.topTitle}>
              {historial.length === 0 ? "Inicio inteligente" : "Conversación activa"}
            </h2>
          </div>

          <div style={styles.topActions}>
            <button style={styles.lightButton}>Dashboard</button>
            <button style={styles.status}>
              <span style={styles.dot} /> Activo
            </button>
          </div>
        </header>

        <div ref={chatRef} style={styles.chatArea}>
          <div style={styles.chatInner}>
            <section style={styles.briefingMini}>
              <div>
                <p style={styles.briefingLabel}>Daily Briefing</p>
                <h3 style={styles.briefingTitle}>{briefingVisible.saludo}</h3>
                <p style={styles.briefingResume}>{briefingVisible.resumen}</p>
              </div>

              <div style={styles.scoreCircle}>
                <strong>{briefingVisible.score || 0}</strong>
                <span>Score</span>
              </div>

              <button
                onClick={() => setBriefingAbierto(!briefingAbierto)}
                style={styles.openBriefing}
              >
                {briefingAbierto ? "Ocultar" : "Ver briefing"}
              </button>
            </section>

            {briefingAbierto && (
              <section style={styles.briefingExpanded}>
                <div style={styles.priorityGrid}>
                  <div>{briefingVisible.prioridad_1}</div>
                  <div>{briefingVisible.prioridad_2}</div>
                  <div>{briefingVisible.prioridad_3}</div>
                </div>

                <div style={styles.recommendation}>
                  {briefingVisible.recomendacion_principal}
                </div>
              </section>
            )}

            {historial.length === 0 && (
              <section style={styles.welcome}>
                <div style={styles.eosOrb}>E</div>
                <h1>¿Qué toca hoy, {nombre}?</h1>
                <p>
                  EOS puede ayudarte a ordenar tu vida personal, empresa, negocio,
                  documentos, objetivos, finanzas y decisiones.
                </p>

                <div style={styles.quickGrid}>
                  {acciones.map((accion) => (
                    <button key={accion} onClick={() => enviarMensaje(accion)} style={styles.quickAction}>
                      {accion}
                    </button>
                  ))}
                </div>
              </section>
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

                {item.rol === "usuario" && (
                  <Avatar letra={nombre.charAt(0).toUpperCase()} usuario />
                )}
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
      </section>

      <aside style={styles.rightPanel}>
        <div style={styles.panelCard}>
          <p style={styles.panelLabel}>Objetivo activo</p>
          <h3>Construir sistema EOS</h3>
          <div style={styles.progressBar}>
            <div style={styles.progressFill} />
          </div>
          <p>72% de avance estimado</p>
        </div>

        <div style={styles.panelCard}>
          <p style={styles.panelLabel}>Acciones sugeridas</p>
          <ul style={styles.panelList}>
            <li>Completar perfil EOS</li>
            <li>Registrar prioridades</li>
            <li>Generar briefing real</li>
            <li>Crear tablero del usuario</li>
          </ul>
        </div>

        <div style={styles.panelCard}>
          <p style={styles.panelLabel}>Archivos</p>
          <p>Los documentos generados aparecerán acá próximamente.</p>
        </div>
      </aside>
    </main>
  );
}

function Avatar({ letra, usuario }: { letra: string; usuario?: boolean }) {
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        background: usuario ? "#e5e7eb" : "#22d3ee",
        color: "#020617",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
        flexShrink: 0,
      }}
    >
      {letra}
    </div>
  );
}

const styles: any = {
  main: {
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: "280px 1fr 320px",
    background: "#f7f9fc",
    color: "#0f172a",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  sidebar: {
    height: "100vh",
    background: "#ffffff",
    borderRight: "1px solid #e5e7eb",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    overflow: "hidden",
  },
  sidebarTop: {
    flexShrink: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#020617",
    fontWeight: 950,
  },
  brandSmall: {
    margin: 0,
    color: "#0891b2",
    fontWeight: 900,
    fontSize: 13,
  },
  brandTitle: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1,
    fontWeight: 950,
  },
  newChat: {
    width: "100%",
    border: "none",
    background: "#071226",
    color: "#fff",
    borderRadius: 16,
    padding: "15px 16px",
    fontWeight: 900,
    fontSize: 15,
    textAlign: "left",
    cursor: "pointer",
  },
  searchBox: {
    marginTop: 12,
    background: "#f1f5f9",
    color: "#94a3b8",
    borderRadius: 14,
    padding: "13px 14px",
    fontSize: 14,
  },
  nav: {
    marginTop: 14,
    display: "grid",
    gap: 4,
  },
  navItem: {
    border: "none",
    background: "transparent",
    color: "#334155",
    borderRadius: 12,
    padding: "10px 12px",
    textAlign: "left",
    fontWeight: 700,
    cursor: "pointer",
  },
  conversationBlock: {
    flex: 1,
    minHeight: 0,
    borderTop: "1px solid #e5e7eb",
    paddingTop: 12,
  },
  sectionTitle: {
    margin: "0 0 8px",
    fontSize: 11,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 950,
  },
  conversationList: {
    height: "100%",
    overflowY: "auto",
    paddingRight: 4,
  },
  conversationItem: {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "#64748b",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    marginBottom: 4,
  },
  conversationActive: {
    width: "100%",
    border: "none",
    background: "#e0f7ff",
    color: "#075985",
    borderRadius: 12,
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 900,
    marginBottom: 4,
  },
  userBox: {
    flexShrink: 0,
    borderTop: "1px solid #e5e7eb",
    paddingTop: 12,
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  userAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    background: "#071226",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
  },
  content: {
    height: "100vh",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  topbar: {
    height: 70,
    flexShrink: 0,
    borderBottom: "1px solid #e5e7eb",
    background: "rgba(255,255,255,.86)",
    backdropFilter: "blur(18px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 28px",
  },
  topLabel: {
    margin: 0,
    color: "#0891b2",
    fontSize: 12,
    fontWeight: 950,
  },
  topTitle: {
    margin: 0,
    fontSize: 18,
  },
  topActions: {
    display: "flex",
    gap: 10,
  },
  lightButton: {
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: 999,
    padding: "9px 14px",
    fontWeight: 800,
  },
  status: {
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#15803d",
    borderRadius: 999,
    padding: "9px 14px",
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#22c55e",
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "28px 24px 120px",
  },
  chatInner: {
    maxWidth: 880,
    margin: "0 auto",
  },
  briefingMini: {
    border: "1px solid #bae6fd",
    background: "linear-gradient(135deg,#ffffff,#ecfeff)",
    borderRadius: 26,
    padding: 22,
    display: "grid",
    gridTemplateColumns: "1fr 80px auto",
    alignItems: "center",
    gap: 16,
    marginBottom: 18,
    boxShadow: "0 18px 60px rgba(8,47,73,.08)",
  },
  briefingLabel: {
    margin: 0,
    color: "#0891b2",
    fontSize: 12,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: ".12em",
  },
  briefingTitle: {
    margin: "6px 0 4px",
    fontSize: 22,
  },
  briefingResume: {
    margin: 0,
    color: "#475569",
    lineHeight: 1.6,
  },
  scoreCircle: {
    width: 72,
    height: 72,
    borderRadius: 22,
    background: "#071226",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  openBriefing: {
    border: "none",
    background: "#22d3ee",
    color: "#020617",
    borderRadius: 999,
    padding: "12px 16px",
    fontWeight: 900,
    cursor: "pointer",
  },
  briefingExpanded: {
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: 22,
    padding: 18,
    marginBottom: 24,
  },
  priorityGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
  },
  recommendation: {
    marginTop: 12,
    background: "#cffafe",
    color: "#075985",
    borderRadius: 16,
    padding: 14,
    fontWeight: 800,
  },
  welcome: {
    minHeight: "42vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  },
  eosOrb: {
    width: 72,
    height: 72,
    borderRadius: 24,
    background: "linear-gradient(135deg,#22d3ee,#38bdf8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 34,
    fontWeight: 950,
    marginBottom: 22,
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
    background: "#fff",
    borderRadius: 18,
    padding: 18,
    fontWeight: 900,
    textAlign: "left",
    cursor: "pointer",
  },
  messageRow: {
    display: "flex",
    gap: 12,
    marginBottom: 22,
  },
  bubble: {
    maxWidth: "76%",
    padding: "15px 18px",
    borderRadius: 22,
    lineHeight: 1.65,
  },
  eosBubble: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    color: "#0f172a",
  },
  userBubble: {
    background: "#071226",
    color: "#fff",
  },
  meta: {
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.6,
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
    borderRadius: 18,
    padding: 15,
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  downloadButton: {
    background: "#071226",
    color: "#fff",
    textDecoration: "none",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: 900,
  },
  inputDock: {
    position: "fixed",
    left: 280,
    right: 320,
    bottom: 0,
    background: "linear-gradient(to top,#f7f9fc 70%,rgba(247,249,252,0))",
    padding: "28px 24px 14px",
  },
  inputBox: {
    maxWidth: 880,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: 8,
    boxShadow: "0 18px 60px rgba(15,23,42,.11)",
  },
  plusButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    border: "none",
    background: "#f1f5f9",
    fontSize: 22,
    cursor: "pointer",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    padding: "12px 8px",
    fontSize: 15,
    minHeight: 44,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 999,
    border: "none",
    background: "#22d3ee",
    color: "#020617",
    fontWeight: 950,
    fontSize: 20,
    cursor: "pointer",
  },
  note: {
    textAlign: "center",
    color: "#64748b",
    fontSize: 12,
    margin: "8px 0 0",
  },
  rightPanel: {
    height: "100vh",
    background: "#ffffff",
    borderLeft: "1px solid #e5e7eb",
    padding: 18,
    display: "grid",
    alignContent: "start",
    gap: 14,
    overflowY: "auto",
  },
  panelCard: {
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: 22,
    padding: 18,
    boxShadow: "0 14px 40px rgba(15,23,42,.05)",
  },
  panelLabel: {
    margin: 0,
    color: "#0891b2",
    fontSize: 12,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: ".1em",
  },
  progressBar: {
    height: 10,
    background: "#e5e7eb",
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 12,
  },
  progressFill: {
    width: "72%",
    height: "100%",
    background: "linear-gradient(90deg,#22d3ee,#22c55e)",
  },
  panelList: {
    paddingLeft: 18,
    lineHeight: 1.9,
    color: "#475569",
  },
};