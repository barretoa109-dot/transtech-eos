"use client";

import { useEffect, useRef, useState } from "react";

type Mensaje = {
  rol: "usuario" | "eos";
  texto: string;
};

export default function EOSPage() {
  const [mensaje, setMensaje] = useState("");
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [historial, setHistorial] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const usuarioNombre = localStorage.getItem("usuario_nombre") || "Usuario";
    const usuarioPlan = localStorage.getItem("usuario_plan") || "free";

    setNombre(usuarioNombre);
    setPlan(usuarioPlan);

    const guardado = localStorage.getItem("eos_historial");

    if (guardado) {
      try {
        setHistorial(JSON.parse(guardado));
      } catch {
        setHistorial([]);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("eos_historial", JSON.stringify(historial));

    setTimeout(() => {
      chatRef.current?.scrollTo({
        top: chatRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 100);
  }, [historial]);

  const limpiarRespuesta = (valor: any): string => {
    let texto = "";

    if (typeof valor === "string") {
      texto = valor;
    } else if (valor?.respuesta) {
      texto = valor.respuesta;
    } else {
      texto = JSON.stringify(valor || "");
    }

    try {
      const parsed = JSON.parse(texto);
      if (parsed?.respuesta) texto = parsed.respuesta;
    } catch {}

    return texto
      .replace(/^=/, "")
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/^\s*{\s*"respuesta"\s*:\s*"/, "")
      .replace(/"\s*}\s*$/, "")
      .trim();
  };

  const obtenerRespuesta = async (response: Response): Promise<string> => {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await response.json();
      return limpiarRespuesta(data?.respuesta ?? data);
    }

    const texto = await response.text();
    return limpiarRespuesta(texto);
  };

  const enviarMensaje = async () => {
    if (!mensaje.trim() || cargando) return;

    const textoUsuario = mensaje.trim();
    const historialActual = historial;

    setHistorial((prev) => [
      ...prev,
      { rol: "usuario", texto: textoUsuario },
      { rol: "eos", texto: "EOS está analizando tu situación..." },
    ]);

    setMensaje("");
    setCargando(true);

    try {
      const response = await fetch(
        "https://n8n-production-6cdb.up.railway.app/webhook/eos-chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre,
            plan,
            mensaje: textoUsuario,
            historial: historialActual.slice(-10),
            origen: "eos-web",
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Error en n8n");
      }

      const respuestaLimpia = await obtenerRespuesta(response);

      setHistorial((prev) => [
        ...prev.slice(0, -1),
        {
          rol: "eos",
          texto:
            respuestaLimpia ||
            "Recibí tu mensaje. Necesito un poco más de contexto para ayudarte bien.",
        },
      ]);
    } catch {
      setHistorial((prev) => [
        ...prev.slice(0, -1),
        {
          rol: "eos",
          texto: "No pude conectarme. Probá nuevamente en unos segundos.",
        },
      ]);
    } finally {
      setCargando(false);
    }
  };

  const nuevoChat = () => {
    localStorage.removeItem("eos_historial");
    setHistorial([]);
  };

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

          <button onClick={nuevoChat} style={styles.newButton}>
            + Nuevo diagnóstico
          </button>

          <div style={styles.menuSection}>
            <p style={styles.menuTitle}>Conversaciones</p>
            <div style={styles.chatItem}>Diagnóstico actual</div>
            <div style={styles.chatItemMuted}>Crecimiento comercial</div>
            <div style={styles.chatItemMuted}>Finanzas del negocio</div>
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
                  Contale a EOS qué está pasando en tu negocio. Primero va a
                  entender tu situación y después te va a guiar paso a paso.
                </p>

                <div style={styles.suggestionsGrid}>
                  {sugerencias.map((item) => (
                    <button
                      key={item}
                      onClick={() => setMensaje(item)}
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
                  <div style={styles.messageText}>{item.texto}</div>
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
              onClick={enviarMensaje}
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
            EOS puede ayudarte a diagnosticar, ordenar y hacer crecer tu negocio.
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
    background: "rgba(255,255,255,0.08)",
    borderRadius: "14px",
    padding: "13px",
    marginBottom: "8px",
    fontSize: "14px",
  },
  chatItemMuted: {
    color: "#94a3b8",
    borderRadius: "14px",
    padding: "13px",
    marginBottom: "8px",
    fontSize: "14px",
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