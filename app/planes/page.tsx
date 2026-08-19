"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Check,
  Crown,
  Loader2,
  Mail,
  Send,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AmbientBackground from "@/components/effects/AmbientBackground";
import { planesTechCanvas } from "@/components/effects/techCanvasPresets";
import { useNavScrolled } from "@/components/effects/useNavScrolled";

type PlanRow = {
  id: string;
  nombre?: string | null;
  precio?: string | null;
  descripcion?: string | null;
  codigo?: string | null;
  precio_mensual_pyg?: number | null;
  precio_anual_pyg?: number | null;
  precio_mensual_usd?: number | null;
  precio_anual_usd?: number | null;
  limite_mensajes?: number | null;
  limite_excel?: number | null;
  limite_pdf?: number | null;
  limite_automatizaciones?: number | null;
  limite_usuarios?: number | null;
  memoria_dias?: number | null;
  prioridad?: number | null;
  es_publico?: boolean | null;
  activo?: boolean | null;
  orden?: number | null;
};

type EstadoComercial = {
  plan_codigo?: string | null;
  plan_nombre?: string | null;
  estado_suscripcion?: string | null;
};

const CODIGOS_PUBLICOS = ["free", "personal", "pro", "business", "enterprise"];

export default function PlanesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const scrolled = useNavScrolled();

  const [planes, setPlanes] = useState<PlanRow[]>([]);
  const [planActual, setPlanActual] = useState("free");
  const [periodicidad, setPeriodicidad] = useState<"mensual" | "anual">("mensual");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [seleccionando, setSeleccionando] = useState("");
  const [mostrarContacto, setMostrarContacto] = useState(false);
  const [enviandoContacto, setEnviandoContacto] = useState(false);
  const [contactoEnviado, setContactoEnviado] = useState(false);
  const [errorContacto, setErrorContacto] = useState("");
  const [contacto, setContacto] = useState({
    nombre: "",
    email: "",
    empresa: "",
    telefono: "",
    mensaje: "",
    website: "",
  });

  useEffect(() => {
    let activo = true;

    async function cargarPlanes() {
      setCargando(true);
      setError("");

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        const { data: planesData, error: planesError } = await supabase
          .from("planes")
          .select("*")
          .eq("activo", true)
          .eq("es_publico", true)
          .order("orden", { ascending: true });

        if (planesError) throw planesError;

        const planesValidos = (planesData || [])
          .filter((plan: PlanRow) => CODIGOS_PUBLICOS.includes(normalizarCodigo(plan.codigo)))
          .sort((a: PlanRow, b: PlanRow) => (a.orden ?? a.prioridad ?? 999) - (b.orden ?? b.prioridad ?? 999));

        if (activo) setPlanes(planesValidos);

        if (user) {
          if (activo) {
            setContacto((actual) => ({
              ...actual,
              nombre: actual.nombre || user.user_metadata?.nombre || user.user_metadata?.name || "",
              email: actual.email || user.email || "",
            }));
          }

          const { data: estadoData } = await supabase.rpc("obtener_estado_comercial_eos", {
            p_usuario_id: user.id,
          });

          const estado = normalizarEstado(estadoData);
          const codigoActual = normalizarCodigo(estado?.plan_codigo) || normalizarCodigo(estado?.plan_nombre) || "free";

          if (activo) setPlanActual(codigoActual);
        }
      } catch (err) {
        console.error("No se pudieron cargar los planes:", err);
        if (activo) {
          setError("No pudimos cargar los planes en este momento. Volvé a intentarlo.");
        }
      } finally {
        if (activo) setCargando(false);
      }
    }

    cargarPlanes();

    return () => {
      activo = false;
    };
  }, [supabase]);

  async function seleccionarPlan(plan: PlanRow) {
    const codigo = normalizarCodigo(plan.codigo);

    if (!codigo || codigo === planActual) return;

    if (codigo === "enterprise") {
      setContactoEnviado(false);
      setErrorContacto("");
      setMostrarContacto(true);
      return;
    }

    setSeleccionando(codigo);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push(`/login?redirect=/planes&plan=${codigo}`);
        return;
      }

      sessionStorage.setItem(
        "eos_plan_seleccionado",
        JSON.stringify({
          codigo,
          periodicidad,
          plan_id: plan.id,
        }),
      );

      router.push(`/pago?plan=${codigo}&periodicidad=${periodicidad}`);
    } finally {
      window.setTimeout(() => setSeleccionando(""), 500);
    }
  }

  async function enviarSolicitudEnterprise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!contacto.nombre.trim() || !contacto.email.trim()) {
      setErrorContacto("Completá tu nombre y correo electrónico.");
      return;
    }

    setEnviandoContacto(true);
    setErrorContacto("");

    try {
      const respuesta = await fetch("/api/ventas/contacto", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...contacto,
          plan: "enterprise",
          origen: "pagina_planes",
        }),
      });

      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(resultado?.error || "No se pudo enviar la solicitud.");
      }

      setContactoEnviado(true);
      setContacto((actual) => ({
        ...actual,
        empresa: "",
        telefono: "",
        mensaje: "",
        website: "",
      }));
    } catch (err) {
      console.error("No se pudo enviar el contacto comercial:", err);
      setErrorContacto(err instanceof Error ? err.message : "No se pudo enviar la solicitud. Intentá nuevamente.");
    } finally {
      setEnviandoContacto(false);
    }
  }

  return (
    <main className="planes-page" data-eos-theme="light">
      <AmbientBackground techConfig={planesTechCanvas} spanCount={2} />

      <nav className={scrolled ? "scrolled" : ""}>
        <div className="wrap nav-inner">
          <div className="nav-brand">
            <img src="/transtech-logo.png" alt="TransTech" />
            <span>TRANSTECH</span>
          </div>
          <div className="nav-actions">
            <Link className="btn btn-outline" href="/eos">
              Volver a EOS
            </Link>
          </div>
        </div>
      </nav>

      <div className="head wrap">
        <h1 className="head-title">Elegí el nivel de EOS que acompaña tu crecimiento.</h1>
        <p className="head-sub">
          Empezá gratis y ampliá tus capacidades cuando lo necesites. Tu plan, tus límites y tu facturación se
          actualizan automáticamente desde tu cuenta.
        </p>
        <div className="toggle-wrap">
          <div className="toggle">
            <button
              type="button"
              className={periodicidad === "mensual" ? "active" : ""}
              onClick={() => setPeriodicidad("mensual")}
            >
              Mensual
            </button>
            <button
              type="button"
              className={periodicidad === "anual" ? "active" : ""}
              onClick={() => setPeriodicidad("anual")}
            >
              Anual <span className="badge">Mejor valor</span>
            </button>
          </div>
        </div>
      </div>

      <div className="wrap">
        {cargando ? (
          <div className="state-card">
            <Loader2 className="spin" size={24} />
            Cargando planes...
          </div>
        ) : error ? (
          <div className="state-card">
            <strong>No se pudieron cargar los planes</strong>
            <p>{error}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          </div>
        ) : (
          <div className="plans">
            {planes.map((plan) => {
              const codigo = normalizarCodigo(plan.codigo);
              const esActual = codigo === planActual;
              const esPremium = codigo === "pro";
              const esExecutive = codigo === "enterprise";
              const precio = obtenerPrecio(plan, periodicidad);
              const caracteristicas = obtenerCaracteristicas(plan);

              return (
                <div
                  key={plan.id}
                  className={`plan ${esPremium ? "premium" : ""} ${esExecutive ? "executive" : ""}`}
                >
                  {esPremium && (
                    <div className="plan-badge">
                      <Sparkles size={12} />
                      MÁS ELEGIDO
                    </div>
                  )}

                  <div className="plan-ic">{obtenerIcono(codigo)}</div>
                  <div className="plan-tag">{codigo.toUpperCase()}</div>
                  <div className="plan-name">{plan.nombre || `EOS ${capitalizar(codigo)}`}</div>
                  <div className="plan-desc">
                    {plan.descripcion || "Capacidades de TransTech EOS adaptadas a este nivel."}
                  </div>

                  <div className="plan-price">
                    <span className="amount">{precio.principal}</span>{" "}
                    {precio.detalle && <span className="per">{precio.detalle}</span>}
                  </div>
                  <div className="plan-price-sub">{periodicidad === "anual" && !esActual ? "facturado anualmente" : ""}</div>

                  <button
                    type="button"
                    disabled={esActual || seleccionando === codigo}
                    onClick={() => seleccionarPlan(plan)}
                    className={`plan-btn ${esPremium ? "primary" : ""} ${esActual ? "current" : ""}`}
                  >
                    {seleccionando === codigo ? (
                      <>
                        <Loader2 className="spin" size={13} />
                        Preparando...
                      </>
                    ) : esActual ? (
                      <>
                        <Check size={13} />
                        Plan actual
                      </>
                    ) : esExecutive ? (
                      "Hablar con ventas →"
                    ) : (
                      "Elegir plan →"
                    )}
                  </button>

                  <div className="plan-includes-label">Este plan incluye</div>
                  {caracteristicas.map((item) => (
                    <div key={item} className="plan-feat">
                      <Check size={14} />
                      {item}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <p className="note">Precios y capacidades obtenidos directamente desde TransTech EOS.</p>
      </div>

      <footer className="support-footer">
        <div className="wrap">
          ¿Necesitás ayuda? Contactá a nuestro equipo de soporte:{" "}
          <a href="mailto:soporte@transtech.com.py">soporte@transtech.com.py</a>
        </div>
      </footer>

      {mostrarContacto && (
        <div
          className="contact-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMostrarContacto(false);
          }}
        >
          <section className="contact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-title">
            <button
              type="button"
              className="contact-close"
              onClick={() => setMostrarContacto(false)}
              aria-label="Cerrar formulario"
            >
              <X size={18} />
            </button>

            {contactoEnviado ? (
              <div className="contact-success">
                <span className="contact-success-icon">
                  <Check size={25} />
                </span>
                <span className="section-label">SOLICITUD ENVIADA</span>
                <h2 id="contact-title">Ventas ya recibió tu consulta.</h2>
                <p>
                  Te responderemos al correo <strong>{contacto.email}</strong>.
                </p>
                <button type="button" onClick={() => setMostrarContacto(false)}>
                  Volver a los planes
                </button>
              </div>
            ) : (
              <>
                <div className="contact-heading">
                  <span className="contact-heading-icon">
                    <Mail size={22} />
                  </span>
                  <div>
                    <span className="section-label">EOS ENTERPRISE</span>
                    <h2 id="contact-title">Hablemos de tu organización.</h2>
                  </div>
                </div>

                <p className="contact-intro">
                  Completá tus datos y TransTech enviará automáticamente la solicitud a ventas@transtech.com.py.
                </p>

                <form className="contact-form" onSubmit={enviarSolicitudEnterprise}>
                  <div className="contact-fields">
                    <label>
                      <span>Nombre *</span>
                      <input
                        value={contacto.nombre}
                        onChange={(event) => setContacto((actual) => ({ ...actual, nombre: event.target.value }))}
                        required
                        maxLength={120}
                        autoComplete="name"
                      />
                    </label>

                    <label>
                      <span>Correo *</span>
                      <input
                        type="email"
                        value={contacto.email}
                        onChange={(event) => setContacto((actual) => ({ ...actual, email: event.target.value }))}
                        required
                        maxLength={180}
                        autoComplete="email"
                      />
                    </label>

                    <label>
                      <span>Empresa</span>
                      <input
                        value={contacto.empresa}
                        onChange={(event) => setContacto((actual) => ({ ...actual, empresa: event.target.value }))}
                        maxLength={160}
                        autoComplete="organization"
                      />
                    </label>

                    <label>
                      <span>Teléfono</span>
                      <input
                        value={contacto.telefono}
                        onChange={(event) => setContacto((actual) => ({ ...actual, telefono: event.target.value }))}
                        maxLength={50}
                        autoComplete="tel"
                      />
                    </label>
                  </div>

                  <label className="contact-message">
                    <span>¿Qué necesita tu organización?</span>
                    <textarea
                      value={contacto.mensaje}
                      onChange={(event) => setContacto((actual) => ({ ...actual, mensaje: event.target.value }))}
                      maxLength={2000}
                      rows={5}
                      placeholder="Contanos brevemente sobre tu empresa, cantidad de usuarios y procesos que querés automatizar."
                    />
                  </label>

                  <label className="contact-honeypot" aria-hidden="true">
                    Sitio web
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={contacto.website}
                      onChange={(event) => setContacto((actual) => ({ ...actual, website: event.target.value }))}
                    />
                  </label>

                  {errorContacto && <p className="contact-error">{errorContacto}</p>}

                  <button type="submit" className="contact-submit" disabled={enviandoContacto}>
                    {enviandoContacto ? (
                      <>
                        <Loader2 className="spin" size={17} />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send size={17} />
                        Enviar a ventas
                      </>
                    )}
                  </button>

                  <p className="contact-privacy">Tus datos se utilizarán únicamente para responder esta consulta comercial.</p>
                </form>
              </>
            )}
          </section>
        </div>
      )}

      <style jsx>{`
        .planes-page {
          --bg: #ffffff;
          --bg-2: #f1f5fb;
          --surface: #f6f8fc;
          --surface-hover: #eef3fb;
          --border: #e5e9f0;
          --border-hover: rgba(22, 86, 189, 0.5);
          --text: #07132a;
          --muted: #6b7280;
          --blue: #1656bd;
          --blue-dark: #113f8c;
          --blue-bright: #2f72d6;
          --blue-light: #e9f0fb;
          --green: #10a37f;
          --green-light: #e6f7f1;
          --ease: cubic-bezier(0.22, 1, 0.36, 1);
          position: relative;
          font-family: var(--font-inter), Inter, Arial, Helvetica, sans-serif;
          background: var(--bg);
          color: var(--text);
          overflow-x: hidden;
          min-height: 100vh;
        }
        .planes-page :global(svg) {
          width: 16px;
          height: 16px;
          stroke: currentColor;
          stroke-width: 1.8;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
          display: block;
        }
        .planes-page a {
          color: inherit;
          text-decoration: none;
        }
        .planes-page button {
          font-family: inherit;
          cursor: pointer;
        }

        .wrap {
          max-width: 1080px;
          margin: 0 auto;
          padding: 0 32px;
          position: relative;
          z-index: 1;
        }

        nav {
          position: sticky;
          top: 0;
          z-index: 50;
          padding: 18px 0;
          transition: background 0.25s, border-color 0.25s, padding 0.25s;
          border-bottom: 1px solid transparent;
        }
        nav.scrolled {
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(14px);
          border-color: var(--border);
          padding: 13px 0;
        }
        .nav-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .nav-brand {
          display: flex;
          align-items: center;
          gap: 11px;
        }
        .nav-brand img {
          height: 24px;
          width: auto;
          display: block;
        }
        .nav-brand span {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.3px;
        }
        :global(.btn) {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 13.5px;
          font-weight: 700;
          cursor: pointer;
          border: none;
          transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
        }
        :global(.btn-outline) {
          background: #fff;
          color: var(--text);
          border: 1px solid var(--border);
        }
        :global(.btn-outline:hover) {
          border-color: var(--border-hover);
          background: var(--surface);
          transform: translateY(-2px);
        }

        .head {
          padding: 70px 0 20px;
          text-align: center;
        }
        .head-title {
          font-size: 44px;
          font-weight: 800;
          letter-spacing: -1.2px;
          line-height: 1.2;
          max-width: 760px;
          margin: 0 auto 18px;
        }
        .head-sub {
          font-size: 15.5px;
          color: var(--muted);
          max-width: 560px;
          margin: 0 auto 36px;
          line-height: 1.65;
        }

        .toggle-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 60px;
        }
        .toggle {
          display: inline-flex;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 4px;
          gap: 2px;
        }
        .toggle button {
          padding: 9px 20px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 700;
          background: transparent;
          color: var(--muted);
          border: none;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.2s, color 0.2s;
        }
        .toggle button.active {
          background: var(--text);
          color: #fff;
        }
        .toggle .badge {
          font-size: 10px;
          font-weight: 700;
          background: var(--blue-light);
          color: var(--blue);
          padding: 2px 8px;
          border-radius: 999px;
        }

        .state-card {
          max-width: 620px;
          min-height: 180px;
          display: grid;
          place-content: center;
          gap: 12px;
          margin: 55px auto 0;
          padding: 30px;
          border: 1px solid var(--border);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.92);
          color: var(--muted);
          text-align: center;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.07);
        }
        .state-card strong {
          color: var(--text);
          font-size: 20px;
        }
        .state-card button {
          width: fit-content;
          min-height: 40px;
          margin: 4px auto 0;
          padding: 0 17px;
          border: 0;
          border-radius: 999px;
          background: var(--blue);
          color: #fff;
          font-weight: 800;
        }

        .plans {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 22px;
          padding-bottom: 60px;
          align-items: stretch;
        }
        .planes-page :global(.plan) {
          border: 1px solid var(--border);
          border-radius: 22px;
          padding: 34px 30px;
          background: #fff;
          display: flex;
          flex-direction: column;
          transition: transform 0.25s var(--ease), box-shadow 0.25s var(--ease), border-color 0.2s;
          position: relative;
        }
        .planes-page :global(.plan:hover) {
          transform: translateY(-5px);
          box-shadow: 0 22px 44px rgba(15, 23, 42, 0.08);
          border-color: var(--border-hover);
        }
        .planes-page :global(.plan.premium) {
          border-color: var(--blue);
          box-shadow: 0 20px 44px rgba(22, 86, 189, 0.12);
        }
        .planes-page :global(.plan.premium:hover) {
          transform: translateY(-8px);
        }
        .planes-page :global(.plan.executive) {
          background: linear-gradient(165deg, #0d1f42, #07132a);
          color: #fff;
          border-color: #0d1f42;
        }
        .plan-badge {
          position: absolute;
          top: -14px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #2f72d6, #1656bd);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          padding: 7px 16px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          gap: 5px;
          box-shadow: 0 8px 18px rgba(22, 86, 189, 0.4);
          white-space: nowrap;
        }
        .plan-ic {
          width: 44px;
          height: 44px;
          border-radius: 13px;
          background: var(--blue-light);
          color: var(--blue);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }
        .planes-page :global(.plan.executive) .plan-ic {
          background: rgba(255, 255, 255, 0.1);
          color: #facc15;
        }
        .plan-tag {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.7px;
          color: var(--muted);
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .planes-page :global(.plan.executive) .plan-tag {
          color: #6fa3e8;
        }
        .plan-name {
          font-size: 21px;
          font-weight: 800;
          margin-bottom: 10px;
        }
        .plan-desc {
          font-size: 13px;
          color: var(--muted);
          line-height: 1.6;
          margin-bottom: 26px;
          min-height: 60px;
        }
        .planes-page :global(.plan.executive) .plan-desc {
          color: #a9b6cc;
        }
        .plan-price {
          font-size: 30px;
          font-weight: 800;
          letter-spacing: -0.6px;
          margin-bottom: 2px;
        }
        .plan-price .per {
          font-size: 13px;
          font-weight: 500;
          color: var(--muted);
        }
        .planes-page :global(.plan.executive) .plan-price .per {
          color: #8b96a8;
        }
        .plan-price-sub {
          font-size: 11.5px;
          color: var(--muted);
          margin-bottom: 22px;
          min-height: 16px;
        }
        .planes-page :global(.plan.executive) .plan-price-sub {
          color: #8b96a8;
        }
        .plan-btn {
          width: 100%;
          padding: 12px;
          border-radius: 11px;
          font-size: 13.5px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          margin-bottom: 28px;
          border: 1px solid var(--border);
          background: #fff;
          color: var(--text);
          transition: transform 0.15s, background 0.2s;
        }
        .plan-btn:hover:not(:disabled) {
          transform: translateY(-2px);
        }
        .plan-btn.current {
          background: var(--green-light);
          color: var(--green);
          border-color: transparent;
          cursor: default;
        }
        .plan-btn.current:hover {
          transform: none;
        }
        .plan-btn.primary {
          background: linear-gradient(135deg, var(--blue-bright), var(--blue-dark));
          color: #fff;
          border: none;
          box-shadow: 0 8px 20px rgba(22, 86, 189, 0.35);
        }
        .planes-page :global(.plan.executive) .plan-btn:not(.primary) {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.14);
          color: #fff;
        }
        .plan-includes-label {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.6px;
          color: var(--muted);
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .planes-page :global(.plan.executive) .plan-includes-label {
          color: #8b96a8;
        }
        .plan-feat {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          font-size: 13px;
          margin-bottom: 12px;
          line-height: 1.45;
        }
        .plan-feat :global(svg) {
          flex-shrink: 0;
          margin-top: 1px;
          color: var(--blue);
        }
        .planes-page :global(.plan.executive) .plan-feat :global(svg) {
          color: #4ade80;
        }

        .note {
          max-width: 680px;
          margin: 0 auto 50px;
          text-align: center;
          font-size: 13px;
          color: var(--muted);
          line-height: 1.7;
        }
        .support-footer {
          border-top: 1px solid var(--border);
          padding: 26px 0 40px;
          text-align: center;
          font-size: 13px;
          color: var(--muted);
        }
        .support-footer a {
          color: var(--blue);
          font-weight: 600;
        }

        .spin {
          animation: spin 800ms linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .contact-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(7, 18, 38, 0.58);
          backdrop-filter: blur(12px);
        }
        .contact-modal {
          position: relative;
          width: min(680px, 100%);
          max-height: calc(100vh - 44px);
          overflow-y: auto;
          padding: 31px;
          border: 1px solid rgba(22, 86, 189, 0.2);
          border-radius: 30px;
          background: #ffffff;
          box-shadow: 0 34px 100px rgba(7, 18, 38, 0.3);
        }
        .contact-close {
          position: absolute;
          top: 18px;
          right: 18px;
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border: 1px solid var(--border);
          border-radius: 13px;
          background: var(--surface);
          color: var(--muted);
        }
        .contact-heading {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding-right: 48px;
        }
        .contact-heading-icon,
        .contact-success-icon {
          width: 49px;
          height: 49px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 16px;
          background: var(--blue-light);
          color: var(--blue);
        }
        .contact-heading :global(h2),
        .contact-success :global(h2) {
          margin: 8px 0 0;
          color: var(--text);
          font-size: 29px;
          font-weight: 900;
          letter-spacing: -0.04em;
        }
        .contact-intro {
          margin: 18px 0 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.7;
        }
        .contact-form {
          margin-top: 23px;
        }
        .contact-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }
        .contact-form :global(label) {
          display: grid;
          gap: 7px;
        }
        .contact-form :global(label > span) {
          color: var(--text);
          font-size: 9px;
          font-weight: 850;
        }
        .contact-form :global(input),
        .contact-form :global(textarea) {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: 13px;
          background: var(--surface);
          color: var(--text);
          font-family: inherit;
          font-size: 12px;
          outline: none;
          transition: border-color 0.16s, box-shadow 0.16s, background 0.16s;
        }
        .contact-form :global(input) {
          min-height: 45px;
          padding: 0 13px;
        }
        .contact-form :global(textarea) {
          resize: vertical;
          min-height: 112px;
          padding: 12px 13px;
          line-height: 1.6;
        }
        .contact-form :global(input:focus),
        .contact-form :global(textarea:focus) {
          border-color: var(--blue);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(22, 86, 189, 0.1);
        }
        .contact-message {
          margin-top: 14px;
        }
        .contact-honeypot {
          position: absolute !important;
          left: -10000px !important;
          width: 1px !important;
          height: 1px !important;
          overflow: hidden !important;
        }
        .contact-error {
          margin: 13px 0 0;
          padding: 11px 13px;
          border: 1px solid #fecaca;
          border-radius: 12px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 10px;
          font-weight: 700;
        }
        .contact-submit,
        .contact-success :global(button) {
          min-height: 47px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          margin-top: 17px;
          padding: 0 20px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(135deg, var(--blue-bright), var(--blue-dark));
          color: #ffffff;
          font-size: 11px;
          font-weight: 900;
          box-shadow: 0 14px 30px rgba(22, 86, 189, 0.22);
        }
        .contact-submit {
          width: 100%;
        }
        .contact-submit:disabled {
          opacity: 0.65;
          cursor: wait;
        }
        .contact-privacy {
          margin: 11px 0 0;
          color: var(--muted);
          font-size: 8px;
          line-height: 1.55;
          text-align: center;
        }
        .contact-success {
          display: grid;
          justify-items: center;
          padding: 22px 10px 10px;
          text-align: center;
        }
        .contact-success-icon {
          margin-bottom: 17px;
          background: #f0fdf4;
          color: #16a34a;
        }
        .contact-success :global(p) {
          margin: 14px 0 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.65;
        }
        .section-label {
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.14em;
          color: var(--blue);
        }

        @media (max-width: 900px) {
          .plans {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function normalizarEstado(data: unknown): EstadoComercial | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    return (data[0] || null) as EstadoComercial | null;
  }

  if (typeof data === "object") {
    return data as EstadoComercial;
  }

  return null;
}

function normalizarCodigo(value?: string | null) {
  const codigo = (value || "").trim().toLowerCase().replace(/^eos\s+/, "");

  if (codigo === "inicial") return "personal";
  return codigo;
}

function capitalizar(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatearGs(valor?: number | null) {
  if (valor === null || valor === undefined) return null;

  return new Intl.NumberFormat("es-PY", {
    maximumFractionDigits: 0,
  }).format(valor);
}

function obtenerPrecio(plan: PlanRow, periodicidad: "mensual" | "anual") {
  const codigo = normalizarCodigo(plan.codigo);

  if (codigo === "free") {
    return { principal: "Gratis", detalle: "para comenzar" };
  }

  if (codigo === "enterprise") {
    return { principal: "Personalizado", detalle: "según alcance" };
  }

  const valor = periodicidad === "anual" ? plan.precio_anual_pyg : plan.precio_mensual_pyg;

  if (valor !== null && valor !== undefined) {
    return {
      principal: `Gs. ${formatearGs(valor)}`,
      detalle: periodicidad === "anual" ? "/año" : "/mes",
    };
  }

  return {
    principal: plan.precio || "Consultar",
    detalle: periodicidad === "anual" ? "facturación anual" : "",
  };
}

function limiteVisible(valor: number | null | undefined, singular: string, plural: string) {
  if (valor === null || valor === undefined) return null;
  if (valor < 0) return `${plural} ilimitados`;
  if (valor === 0) return `Sin ${plural.toLowerCase()}`;
  return `${valor.toLocaleString("es-PY")} ${valor === 1 ? singular : plural}`;
}

function obtenerCaracteristicas(plan: PlanRow) {
  const codigo = normalizarCodigo(plan.codigo);

  const items = [
    limiteVisible(plan.limite_mensajes, "mensaje", "mensajes"),
    limiteVisible(plan.limite_excel, "Excel", "Excel"),
    limiteVisible(plan.limite_pdf, "PDF", "PDF"),
    limiteVisible(plan.limite_automatizaciones, "automatización", "automatizaciones"),
    plan.memoria_dias === -1
      ? "Memoria contextual ilimitada"
      : plan.memoria_dias
        ? `${plan.memoria_dias} días de memoria contextual`
        : null,
    plan.limite_usuarios && plan.limite_usuarios > 1 ? `Hasta ${plan.limite_usuarios} usuarios` : null,
  ].filter(Boolean) as string[];

  if (codigo === "free") {
    items.unshift("Acceso inicial a EOS");
  }

  if (codigo === "pro") {
    items.unshift("Experiencia completa de EOS");
  }

  if (codigo === "business") {
    items.unshift("Gestión para empresas y equipos");
  }

  if (codigo === "enterprise") {
    items.unshift("Implementación y alcance personalizados");
  }

  return items.slice(0, 7);
}

function obtenerIcono(codigo: string) {
  if (codigo === "free") return <Sparkles size={21} />;
  if (codigo === "personal") return <UserRound size={21} />;
  if (codigo === "pro") return <Crown size={21} />;
  if (codigo === "business") return <UsersRound size={21} />;
  return <Building2 size={21} />;
}
