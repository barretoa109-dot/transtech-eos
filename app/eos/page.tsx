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
  const chatRef = useRef<HTMLDivElement | null>(null);

  const briefingVisible = useMemo<Briefing>(() => {
    return (
      briefing || {
        saludo: `Hola ${nombre}. EOS está listo para ayudarte.`,
        resumen:
          "Cuando converses con EOS, este bloque mostrará tu resumen inteligente, prioridades, score y recomendación principal.",
        prioridad_1: "Definir qué querés mejorar",
        prioridad_2: "Registrar información importante",
        prioridad_3: "Crear una acción concreta",
        recomendacion_principal:
          "Contale a EOS tu situación actual para empezar a construir tu sistema inteligente.",
        score: 0,
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
      .insert([{ usuario_id: uuid, titulo: "Diagnóstico actual" }])
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
      { rol: "eos", texto: "Estoy analizando tu situación..." },
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

  const sugerencias = [
    "Quiero ordenar mis finanzas",
    "Quiero aumentar mis ventas",
    "Generame un Excel para mi negocio",
    "Necesito organizar mi vida personal",
  ];

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

  return (
    <main style={styles.main}>
      <aside style={styles.sidebar}>
        <div>
          <div style={styles.brandBox}>
            <div style={styles.logo}>E</div>
            <div>
              <p style={styles.brandSmall}>TransTech</p>
              <h1 style={styles.brandTitle}>EOS</h1>
            </div>
          </div>

          <button type="button" onClick={() => crearNuevaConversacion()} style={styles.newChat}>
            + Nuevo chat
          </button>

          <div style={styles.menu}>
            <p style={styles.menuTitle}>Conversaciones</p>

            {conversaciones.length === 0 && (
              <div style={styles.emptySide}>Sin conversaciones todavía</div>
            )}

            {conversaciones.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  setConversacionId(c.id);
                  cargarMensajes(c.id);
                }}
                style={c.id === conversacionId ? styles.chatActive : styles.chatMuted}
              >
                {c.titulo || "Conversación EOS"}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.sideBottom}>
          <a href="/dashboard" style={styles.sideLink}>Dashboard</a>
          <a href="/" style={styles.sideLink}>Inicio</a>

          <div style={styles.profile}>
            <small>Usuario</small>
            <strong>{nombre}</strong>
            <span>Plan {plan}</span>
          </div>
        </div>
      </aside>

      <section style={styles.content}>
        <header style={styles.header}>
          <div>
            <p style={styles.headerEyebrow}>EOS OS</p>
            <h2 style={styles.headerTitle}>Asistente inteligente</h2>
          </div>

          <div style={styles.status}>
            <span style={styles.dot} />
            Activo
          </div>
        </header>

        <div ref={chatRef} style={styles.chatArea}>
          <div style={styles.chatContainer}>
            <section style={styles.briefing}>
              <div style={styles.briefingTop}>
                <div>
                  <p style={styles.briefingLabel}>Daily Briefing</p>
                  <h2 style={styles.briefingTitle}>{briefingVisible.saludo}</h2>
                </div>

                <div style={styles.score}>
                  <strong>{briefingVisible.score || 0}</strong>
                  <span>Score</span>
                </div>
              </div>

              <p style={styles.briefingText}>{briefingVisible.resumen}</p>

              <div style={styles.priorities}>
                <div>{briefingVisible.prioridad_1}</div>
                <div>{briefingVisible.prioridad_2}</div>
                <div>{briefingVisible.prioridad_3}</div>
              </div>

              <div style={styles.recommendation}>
                {briefingVisible.recomendacion_principal}
              </div>
            </section>

            {historial.length === 0 && (
              <section style={styles.welcome}>
                <div style={styles.bigLogo}>E</div>
                <h1>¿Qué querés mejorar hoy?</h1>
                <p>
                  EOS puede ayudarte con finanzas personales, negocios, documentos,
                  tareas, objetivos, clientes y seguimiento.
                </p>

                <div style={styles.suggestions}>
                  {sugerencias.map((s) => (
                    <button key={s} onClick={() => enviarMensaje(s)} style={styles.suggestion}>
                      {s}
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

        <div style={styles.inputArea}>
          <div style={styles.inputBox}>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviarMensaje();
                }
              }}
              placeholder="Escribí tu mensaje para EOS..."
              rows={1}
              style={styles.textarea}
            />

            <button onClick={() => enviarMensaje()} disabled={cargando} style={styles.send}>
              {cargando ? "..." : "↑"}
            </button>
          </div>

          <p style={styles.note}>
            EOS puede cometer errores. Usalo como apoyo para decidir mejor.
          </p>
        </div>
      </section>
    </main>
  );
}

function Avatar({ letra, usuario }: { letra: string; usuario?: boolean }) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 999,
        background: usuario ? "#e2e8f0" : "#22d3ee",
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
    display: "flex",
    background: "#f8fbff",
    color: "#0f172a",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  sidebar: {
    width: 300,
    background: "#ffffff",
    borderRight: "1px solid #e2e8f0",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  brandBox: { display: "flex", alignItems: "center", gap: 12 },
  logo: {
    width: 46,
    height: 46,
    borderRadius: 16,
    background: "#22d3ee",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
  },
  brandSmall: { margin: 0, color: "#0891b2", fontWeight: 900 },
  brandTitle: { margin: 0, fontSize: 30, fontWeight: 900 },
  newChat: {
    marginTop: 28,
    width: "100%",
    border: "none",
    background: "#071226",
    color: "white",
    borderRadius: 18,
    padding: 15,
    fontWeight: 900,
    cursor: "pointer",
    textAlign: "left",
  },
  menu: { marginTop: 28 },
  menuTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: ".1em",
    color: "#64748b",
    fontWeight: 900,
  },
  emptySide: { color: "#94a3b8", padding: 12 },
  chatActive: {
    width: "100%",
    border: "none",
    background: "#e0f7ff",
    color: "#075985",
    borderRadius: 14,
    padding: 13,
    textAlign: "left",
    marginBottom: 8,
    fontWeight: 800,
    cursor: "pointer",
  },
  chatMuted: {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "#64748b",
    borderRadius: 14,
    padding: 13,
    textAlign: "left",
    marginBottom: 8,
    cursor: "pointer",
  },
  sideBottom: { display: "grid", gap: 10 },
  sideLink: {
    textDecoration: "none",
    color: "#0f172a",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 13,
    fontWeight: 800,
  },
  profile: {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 15,
    display: "grid",
    gap: 4,
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    height: "100vh",
  },
  header: {
    height: 72,
    background: "rgba(255,255,255,.82)",
    backdropFilter: "blur(16px)",
    borderBottom: "1px solid #e2e8f0",
    padding: "0 32px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerEyebrow: { margin: 0, color: "#0891b2", fontWeight: 900 },
  headerTitle: { margin: 0, fontSize: 18 },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#15803d",
    borderRadius: 999,
    padding: "8px 13px",
    fontWeight: 900,
    fontSize: 13,
  },
  dot: { width: 8, height: 8, borderRadius: 999, background: "#22c55e" },
  chatArea: { flex: 1, overflowY: "auto", padding: "32px 24px" },
  chatContainer: { maxWidth: 920, margin: "0 auto" },
  briefing: {
    background: "linear-gradient(135deg, #ffffff, #ecfeff)",
    border: "1px solid #bae6fd",
    borderRadius: 28,
    padding: 24,
    marginBottom: 34,
    boxShadow: "0 20px 60px rgba(8,47,73,.08)",
  },
  briefingTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    alignItems: "center",
  },
  briefingLabel: {
    margin: 0,
    color: "#0891b2",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: ".12em",
    fontWeight: 900,
  },
  briefingTitle: { margin: "6px 0 0", fontSize: 23 },
  briefingText: { color: "#475569", lineHeight: 1.7 },
  score: {
    width: 82,
    height: 82,
    borderRadius: 24,
    background: "#071226",
    color: "white",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  priorities: {
    display: "grid",
    gridTemplateColumns: "repeat(3,minmax(0,1fr))",
    gap: 12,
    marginTop: 16,
  },
  recommendation: {
    marginTop: 16,
    background: "#cffafe",
    color: "#075985",
    borderRadius: 18,
    padding: 15,
    fontWeight: 800,
  },
  welcome: {
    textAlign: "center",
    padding: "50px 0",
  },
  bigLogo: {
    margin: "0 auto 20px",
    width: 70,
    height: 70,
    borderRadius: 24,
    background: "#22d3ee",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 34,
    fontWeight: 900,
  },
  suggestions: {
    marginTop: 26,
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 12,
  },
  suggestion: {
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    borderRadius: 18,
    padding: 16,
    fontWeight: 800,
    textAlign: "left",
    cursor: "pointer",
  },
  messageRow: { display: "flex", gap: 12, marginBottom: 24 },
  bubble: {
    maxWidth: "76%",
    padding: "16px 19px",
    borderRadius: 24,
    lineHeight: 1.65,
  },
  eosBubble: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    color: "#0f172a",
  },
  userBubble: {
    background: "#071226",
    color: "white",
  },
  meta: {
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.6,
    marginBottom: 5,
  },
  messageText: { whiteSpace: "pre-line", fontSize: 16 },
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
    color: "white",
    textDecoration: "none",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: 900,
  },
  inputArea: {
    background: "rgba(255,255,255,.88)",
    borderTop: "1px solid #e2e8f0",
    padding: 18,
  },
  inputBox: {
    maxWidth: 920,
    margin: "0 auto",
    display: "flex",
    gap: 10,
    background: "white",
    border: "1px solid #cbd5e1",
    borderRadius: 24,
    padding: 10,
    boxShadow: "0 18px 50px rgba(15,23,42,.08)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    padding: 13,
    fontSize: 16,
    minHeight: 48,
  },
  send: {
    width: 50,
    height: 50,
    borderRadius: 18,
    border: "none",
    background: "#22d3ee",
    color: "#020617",
    fontWeight: 900,
    fontSize: 22,
    cursor: "pointer",
  },
  note: {
    textAlign: "center",
    color: "#64748b",
    fontSize: 12,
    marginTop: 8,
  },
};
