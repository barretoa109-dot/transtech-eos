"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type Mensaje = {
  rol: "usuario" | "eos";
  texto: string;
};

type Conversacion = {
  id: string;
  titulo: string | null;
};

export default function EOSPage() {
  const [mensaje, setMensaje] = useState("");
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [usuarioId, setUsuarioId] = useState("");
  const [conversacionId, setConversacionId] = useState("");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [historial, setHistorial] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

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
      .insert([
        {
          usuario_id: uuid,
          titulo: "Diagnóstico actual",
        },
      ])
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
      rol:
        m.remitente === "usuario" || m.rol === "usuario"
          ? "usuario"
          : "eos",
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
      {
        conversacion_id: idConversacion,
        remitente,
        mensaje: texto,
      },
    ]);

    if (!error) return;

    console.log("Primer formato de mensajes falló, probando formato alternativo:", error);

    await supabase.from("mensajes").insert([
      {
        conversacion_id: idConversacion,
        rol: remitente,
        texto,
      },
    ]);
  }

  function extraerTextoEOS(valor: any): string {
    if (!valor) return "";

    if (typeof valor === "string") return valor;

    if (Array.isArray(valor)) {
      return valor.map(extraerTextoEOS).filter(Boolean).join("\n\n");
    }

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
        extraerTextoEOS(valor.content?.[0]?.text) ||
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
    } catch {
      // Si no es JSON válido, seguimos con el texto original.
    }

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

    console.log("RESPUESTA CRUDA EOS:", texto);

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
      {
        rol: "eos",
        texto: "Dame unos segundos, estoy revisando tu situación para responderte bien...",
      },
    ]);

    await guardarMensaje(conversacionActiva, "usuario", textoUsuario);

    try {
      const response = await fetch("/api/eos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

      if (!response.ok) {
        console.log("Error EOS:", response.status, respuestaLimpia);
        throw new Error("Error en EOS");
      }

      const respuestaFinal =
        respuestaLimpia ||
        "Te leo. Contame un poco más de contexto para poder ayudarte mejor.";

      await guardarMensaje(conversacionActiva, "eos", respuestaFinal);

      crearEstructuraOperativa(textoUsuario, respuestaFinal).catch((error) => {
        console.log("Error creando estructura operativa:", error);
      });

      setHistorial((prev) => [
        ...prev.slice(0, -1),
        {
          rol: "eos",
          texto: respuestaFinal,
        },
      ]);
    } catch (error) {
      console.log("ERROR EOS:", error);

      const respuestaError =
        "Ahora mismo no pude conectarme bien. Probá de nuevo en unos segundos y lo seguimos desde acá.";

      await guardarMensaje(conversacionActiva, "eos", respuestaError);

      setHistorial((prev) => [
        ...prev.slice(0, -1),
        {
          rol: "eos",
          texto: respuestaError,
        },
      ]);
    } finally {
      setCargando(false);
    }
  }

  const nuevoChat = async () => {
    await crearNuevaConversacion();
  };

  const abrirConversacion = async (id: string) => {
    setConversacionId(id);
    await cargarMensajes(id);
  };

  function detectarObjetivo(textoUsuario: string, respuestaEOS: string) {
    const texto = `${textoUsuario} ${respuestaEOS}`.toLowerCase();

    if (texto.includes("venta") || texto.includes("clientes")) {
      return "Aumentar ventas y conseguir más clientes";
    }

    if (
      texto.includes("finanza") ||
      texto.includes("deuda") ||
      texto.includes("gasto")
    ) {
      return "Ordenar finanzas y mejorar control económico";
    }

    if (
      texto.includes("negocio") ||
      texto.includes("empresa") ||
      texto.includes("emprendimiento")
    ) {
      return "Ordenar y hacer crecer el negocio";
    }

    if (texto.includes("automatizar") || texto.includes("proceso")) {
      return "Automatizar procesos y ahorrar tiempo";
    }

    return "Mejorar situación actual con apoyo de EOS";
  }

  function generarTareas(textoUsuario: string) {
    const texto = textoUsuario.toLowerCase();

    if (texto.includes("venta") || texto.includes("clientes")) {
      return [
        "Identificar los productos o servicios más rentables",
        "Definir el cliente ideal",
        "Crear una oferta clara para atraer clientes",
        "Medir cuántas consultas se convierten en ventas",
      ];
    }

    if (
      texto.includes("finanza") ||
      texto.includes("deuda") ||
      texto.includes("gasto")
    ) {
      return [
        "Listar ingresos y gastos actuales",
        "Identificar deudas y pagos pendientes",
        "Crear un presupuesto mensual básico",
        "Definir una meta de ahorro o reducción de deuda",
      ];
    }

    if (texto.includes("automatizar") || texto.includes("proceso")) {
      return [
        "Identificar tareas repetitivas",
        "Elegir qué proceso automatizar primero",
        "Definir canal principal de atención",
        "Crear flujo básico de seguimiento",
      ];
    }

    return [
      "Definir el problema principal",
      "Establecer un objetivo claro",
      "Identificar las primeras acciones necesarias",
      "Revisar avances con EOS",
    ];
  }

  async function actualizarProgresoUsuario() {
    if (!usuarioId) return;

    const { data: tareasData } = await supabase
      .from("tareas")
      .select("*")
      .eq("usuario_id", usuarioId);

    const tareas = tareasData || [];
    const completadas = tareas.filter((t: any) => t.completada === true).length;
    const progreso =
      tareas.length > 0 ? Math.round((completadas / tareas.length) * 100) : 10;

    await supabase.from("usuarios").update({ progreso }).eq("id", usuarioId);

    return progreso;
  }

  async function crearEstructuraOperativa(
    textoUsuario: string,
    respuestaEOS: string
  ) {
    if (!usuarioId) return;

    const objetivoTitulo = detectarObjetivo(textoUsuario, respuestaEOS);

    const { data: objetivosActuales } = await supabase
      .from("objetivos")
      .select("*")
      .eq("usuario_id", usuarioId)
      .limit(1);

    let objetivoId = objetivosActuales?.[0]?.id;

    if (!objetivoId) {
      const { data: nuevoObjetivo, error: objetivoError } = await supabase
        .from("objetivos")
        .insert([
          {
            usuario_id: usuarioId,
            titulo: objetivoTitulo,
            descripcion: `Objetivo detectado automáticamente por EOS según la conversación: ${textoUsuario}`,
            porcentaje: 10,
            estado: "Activo",
          },
        ])
        .select()
        .single();

      if (objetivoError) {
        console.log("No se pudo crear objetivo completo, probando mínimo:", objetivoError);

        const { data: objetivoMinimo } = await supabase
          .from("objetivos")
          .insert([
            {
              usuario_id: usuarioId,
              titulo: objetivoTitulo,
            },
          ])
          .select()
          .single();

        objetivoId = objetivoMinimo?.id;
      } else {
        objetivoId = nuevoObjetivo?.id;
      }
    }

    const { data: tareasActuales } = await supabase
      .from("tareas")
      .select("*")
      .eq("usuario_id", usuarioId)
      .limit(1);

    if (!tareasActuales || tareasActuales.length === 0) {
      const tareasGeneradas = generarTareas(textoUsuario);

      const { error: tareasError } = await supabase.from("tareas").insert(
        tareasGeneradas.map((titulo) => ({
          usuario_id: usuarioId,
          titulo,
          completada: false,
        }))
      );

      if (tareasError) {
        console.log("No se pudieron crear tareas:", tareasError);
      }
    }

    const progreso = await actualizarProgresoUsuario();

    const { error: seguimientoError } = await supabase.from("seguimientos").insert([
      {
        usuario_id: usuarioId,
        mensaje: `EOS registró un nuevo avance del proceso. Objetivo actual: ${objetivoTitulo}.`,
        porcentaje: progreso || 10,
        enviado: false,
      },
    ]);

    if (seguimientoError) {
      console.log("No se pudo registrar seguimiento:", seguimientoError);
    }
  }

  const sugerencias = [
    "Quiero aumentar mis ventas",
    "Necesito ordenar mis finanzas",
    "Quiero conseguir más clientes",
    "No sé por dónde empezar",
  ];

  return (
    <main style={styles.main}>
      <aside style={styles.sidebar}>
        <div>
          <div style={styles.logoBox}>
            <div style={styles.logoIcon}>E</div>
            <div>
              <p style={styles.brand}>TransTech</p>
              <h1 style={styles.logoText}>EOS</h1>
            </div>
          </div>

          <button type="button" onClick={nuevoChat} style={styles.newButton}>
            + Nuevo diagnóstico
          </button>

          <div style={styles.menuSection}>
            <p style={styles.menuTitle}>Conversaciones</p>

            {conversaciones.length === 0 && (
              <div style={styles.chatItemMuted}>Sin conversaciones todavía</div>
            )}

            {conversaciones.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => abrirConversacion(c.id)}
                style={
                  c.id === conversacionId
                    ? styles.chatItem
                    : styles.chatItemMutedButton
                }
              >
                {c.titulo || "Conversación EOS"}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.bottomSidebar}>
          <div style={styles.profileCard}>
            <small style={styles.label}>Usuario</small>
            <strong>{nombre}</strong>
          </div>

          <div style={styles.profileCard}>
            <small style={styles.label}>Plan actual</small>
            <strong>{plan}</strong>
          </div>

          <a href="/dashboard" style={styles.backButton}>
            ← Volver al panel
          </a>
        </div>
      </aside>

      <section style={styles.content}>
        <header style={styles.header}>
          <div>
            <p style={styles.headerLabel}>EOS</p>
            <h2 style={styles.headerTitle}>Asesor empresarial inteligente</h2>
          </div>

          <div style={styles.statusPill}>
            <span style={styles.statusDot}></span>
            Activo
          </div>
        </header>

        <div ref={chatRef} style={styles.chatArea}>
          <div style={styles.chatContainer}>
            {historial.length === 0 && (
              <div style={styles.welcomeBox}>
                <div style={styles.bigLogo}>E</div>
                <h1 style={styles.welcomeTitle}>¿Qué querés mejorar hoy?</h1>
                <p style={styles.welcomeText}>
                  Contale a EOS qué está pasando. Voy a ayudarte a diagnosticar,
                  ordenar y avanzar paso a paso.
                </p>

                <div style={styles.suggestionsGrid}>
                  {sugerencias.map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => enviarMensaje(item)}
                      style={styles.suggestionButton}
                    >
                      {item}
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
                  justifyContent:
                    item.rol === "usuario" ? "flex-end" : "flex-start",
                }}
              >
                {item.rol === "eos" && <Avatar letra="E" />}

                <div
                  style={{
                    ...styles.messageBubble,
                    ...(item.rol === "usuario"
                      ? styles.userBubble
                      : styles.eosBubble),
                  }}
                >
                  <div style={styles.messageMeta}>
                    {item.rol === "usuario" ? nombre : "EOS"}
                  </div>
                  <div style={styles.messageText}>
  {item.texto.split("\n").map((linea, i) => {
    const texto = linea.trim();

    if (texto.startsWith("http://") || texto.startsWith("https://")) {
      return (
        <div key={i} style={{ marginTop: 10 }}>
          <a
            href={texto}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#22d3ee",
              fontWeight: 700,
              textDecoration: "underline",
            }}
          >
            📥 Descargar archivo
          </a>
        </div>
      );
    }

    return (
      <div key={i}>
        {linea}
      </div>
    );
  })}
</div>
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

            <button
              type="button"
              onClick={() => enviarMensaje()}
              disabled={cargando}
              style={{
                ...styles.sendButton,
                opacity: cargando ? 0.6 : 1,
              }}
            >
              {cargando ? "..." : "➜"}
            </button>
          </div>

          <p style={styles.footerNote}>
            EOS guarda tu proceso para acompañarte con seguimiento real.
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
        width: "38px",
        height: "38px",
        borderRadius: "999px",
        background: usuario ? "#1e293b" : "#22d3ee",
        color: usuario ? "#ffffff" : "#020617",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
        flexShrink: 0,
        border: usuario ? "1px solid rgba(255,255,255,0.12)" : "none",
      }}
    >
      {letra}
    </div>
  );
}

const styles: any = {
  main: {
    minHeight: "100vh",
    background: "#020617",
    color: "white",
    display: "flex",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  sidebar: {
    width: "300px",
    background:
      "linear-gradient(180deg, rgba(7,18,38,1) 0%, rgba(3,7,18,1) 100%)",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    padding: "22px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  logoBox: {
    display: "flex",
    gap: "14px",
    alignItems: "center",
  },
  logoIcon: {
    width: "46px",
    height: "46px",
    borderRadius: "16px",
    background: "#22d3ee",
    color: "#020617",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: "22px",
  },
  brand: {
    color: "#22d3ee",
    fontWeight: 800,
    margin: 0,
    fontSize: "14px",
  },
  logoText: {
    margin: 0,
    fontSize: "30px",
    fontWeight: 900,
  },
  newButton: {
    marginTop: "30px",
    width: "100%",
    background: "rgba(34,211,238,0.08)",
    border: "1px solid rgba(34,211,238,0.28)",
    color: "#e0faff",
    borderRadius: "16px",
    padding: "15px",
    cursor: "pointer",
    textAlign: "left",
    fontWeight: 800,
  },
  menuSection: {
    marginTop: "30px",
  },
  menuTitle: {
    color: "#64748b",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: "12px",
  },
  chatItem: {
    width: "100%",
    background: "rgba(255,255,255,0.08)",
    borderRadius: "14px",
    padding: "13px",
    marginBottom: "8px",
    fontSize: "14px",
    color: "white",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
  },
  chatItemMuted: {
    color: "#94a3b8",
    borderRadius: "14px",
    padding: "13px",
    marginBottom: "8px",
    fontSize: "14px",
  },
  chatItemMutedButton: {
    width: "100%",
    color: "#94a3b8",
    background: "transparent",
    border: "none",
    borderRadius: "14px",
    padding: "13px",
    marginBottom: "8px",
    fontSize: "14px",
    textAlign: "left",
    cursor: "pointer",
  },
  bottomSidebar: {
    display: "grid",
    gap: "12px",
  },
  profileCard: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "18px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  label: {
    color: "#94a3b8",
  },
  backButton: {
    color: "#cbd5e1",
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "16px",
    padding: "15px",
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background:
      "radial-gradient(circle at top center, rgba(34,211,238,0.08), transparent 35%), #020617",
  },
  header: {
    height: "72px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0 32px",
  },
  headerLabel: {
    color: "#22d3ee",
    fontWeight: 900,
    margin: 0,
  },
  headerTitle: {
    margin: "2px 0 0",
    fontSize: "15px",
    color: "#cbd5e1",
    fontWeight: 500,
  },
  statusPill: {
    border: "1px solid rgba(52,211,153,0.25)",
    background: "rgba(52,211,153,0.08)",
    color: "#6ee7b7",
    borderRadius: "999px",
    padding: "8px 13px",
    fontSize: "13px",
    fontWeight: 800,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "999px",
    background: "#34d399",
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "38px 24px",
  },
  chatContainer: {
    maxWidth: "900px",
    margin: "0 auto",
  },
  welcomeBox: {
    minHeight: "58vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  },
  bigLogo: {
    width: "70px",
    height: "70px",
    borderRadius: "24px",
    background: "#22d3ee",
    color: "#020617",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: "36px",
    boxShadow: "0 0 60px rgba(34,211,238,0.35)",
    marginBottom: "22px",
  },
  welcomeTitle: {
    fontSize: "44px",
    fontWeight: 900,
    margin: 0,
  },
  welcomeText: {
    color: "#94a3b8",
    maxWidth: "620px",
    lineHeight: 1.7,
    marginTop: "14px",
  },
  suggestionsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px",
    marginTop: "30px",
    width: "100%",
    maxWidth: "620px",
  },
  suggestionButton: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#e2e8f0",
    borderRadius: "18px",
    padding: "16px",
    cursor: "pointer",
    textAlign: "left",
    fontWeight: 700,
  },
  messageRow: {
    display: "flex",
    gap: "12px",
    marginBottom: "28px",
  },
  messageBubble: {
    maxWidth: "76%",
    padding: "17px 20px",
    borderRadius: "24px",
    lineHeight: 1.65,
    boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
  },
  eosBubble: {
    background: "rgba(15,23,42,0.95)",
    color: "#f8fafc",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  userBubble: {
    background: "linear-gradient(135deg, #22d3ee, #06b6d4)",
    color: "#020617",
  },
  messageMeta: {
    fontSize: "12px",
    opacity: 0.65,
    fontWeight: 900,
    marginBottom: "5px",
  },
  messageText: {
    whiteSpace: "pre-line",
    fontSize: "16px",
  },
  inputArea: {
    borderTop: "1px solid rgba(255,255,255,0.08)",
    padding: "20px",
    background: "rgba(2,6,23,0.9)",
    backdropFilter: "blur(16px)",
  },
  inputBox: {
    maxWidth: "900px",
    margin: "0 auto",
    display: "flex",
    gap: "12px",
    background: "#071226",
    border: "1px solid rgba(34,211,238,0.18)",
    borderRadius: "24px",
    padding: "12px",
    boxShadow: "0 0 40px rgba(34,211,238,0.08)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    background: "transparent",
    border: "none",
    outline: "none",
    color: "white",
    fontSize: "16px",
    padding: "13px",
    minHeight: "48px",
  },
  sendButton: {
    width: "52px",
    height: "52px",
    background: "#22d3ee",
    color: "#020617",
    border: "none",
    borderRadius: "18px",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: "22px",
  },
  footerNote: {
    textAlign: "center",
    color: "#64748b",
    fontSize: "12px",
    marginTop: "10px",
  },
};
