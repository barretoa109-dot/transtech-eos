"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Crown,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

const CODIGOS_PUBLICOS = [
  "free",
  "personal",
  "pro",
  "business",
  "enterprise",
];

export default function PlanesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [planes, setPlanes] = useState<PlanRow[]>([]);
  const [planActual, setPlanActual] = useState("free");
  const [periodicidad, setPeriodicidad] = useState<"mensual" | "anual">(
    "mensual",
  );
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
          .filter((plan: PlanRow) =>
            CODIGOS_PUBLICOS.includes(normalizarCodigo(plan.codigo)),
          )
          .sort(
            (a: PlanRow, b: PlanRow) =>
              (a.orden ?? a.prioridad ?? 999) -
              (b.orden ?? b.prioridad ?? 999),
          );

        if (activo) setPlanes(planesValidos);

        if (user) {
          if (activo) {
            setContacto((actual) => ({
              ...actual,
              nombre:
                actual.nombre ||
                user.user_metadata?.nombre ||
                user.user_metadata?.name ||
                "",
              email: actual.email || user.email || "",
            }));
          }

          const { data: estadoData } = await supabase.rpc(
            "obtener_estado_comercial_eos",
            {
              p_usuario_id: user.id,
            },
          );

          const estado = normalizarEstado(estadoData);
          const codigoActual =
            normalizarCodigo(estado?.plan_codigo) ||
            normalizarCodigo(estado?.plan_nombre) ||
            "free";

          if (activo) setPlanActual(codigoActual);
        }
      } catch (err) {
        console.error("No se pudieron cargar los planes:", err);
        if (activo) {
          setError(
            "No pudimos cargar los planes en este momento. Volvé a intentarlo.",
          );
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

  async function enviarSolicitudEnterprise(
    event: React.FormEvent<HTMLFormElement>,
  ) {
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
        throw new Error(
          resultado?.error || "No se pudo enviar la solicitud.",
        );
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
      setErrorContacto(
        err instanceof Error
          ? err.message
          : "No se pudo enviar la solicitud. Intentá nuevamente.",
      );
    } finally {
      setEnviandoContacto(false);
    }
  }

  return (
    <main className="plans-page">
      <div className="plans-grid" />
      <div className="plans-glow plans-glow-one" />
      <div className="plans-glow plans-glow-two" />

      <div className="plans-container">
        <header className="plans-topbar">
          <button
            type="button"
            onClick={() => router.back()}
            className="back-button"
          >
            <ArrowLeft size={17} />
            Volver
          </button>

          <div className="brand-lockup">
            <span>TRANSTECH</span>
            <strong>EOS</strong>
          </div>

          <button
            type="button"
            onClick={() => router.push("/eos/chat")}
            className="dashboard-button"
          >
            Ir a EOS
            <ArrowRight size={16} />
          </button>
        </header>

        <section className="plans-hero">
          <div className="eyebrow">
            <Sparkles size={15} />
            PLANES TRANSTECH EOS
          </div>

          <h1>Elegí el nivel de EOS que acompaña tu crecimiento.</h1>

          <p>
            Empezá gratis y ampliá tus capacidades cuando lo necesites.
            Tu plan, tus límites y tu facturación se actualizan
            automáticamente desde tu cuenta.
          </p>

          <div className="billing-toggle">
            <button
              type="button"
              onClick={() => setPeriodicidad("mensual")}
              className={periodicidad === "mensual" ? "active" : ""}
            >
              Mensual
            </button>

            <button
              type="button"
              onClick={() => setPeriodicidad("anual")}
              className={periodicidad === "anual" ? "active" : ""}
            >
              Anual
              <span>Mejor valor</span>
            </button>
          </div>
        </section>

        {cargando ? (
          <section className="loading-card">
            <Loader2 className="spin" size={24} />
            Cargando planes...
          </section>
        ) : error ? (
          <section className="error-card">
            <strong>No se pudieron cargar los planes</strong>
            <p>{error}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          </section>
        ) : (
          <section className="plans-grid-cards">
            {planes.map((plan) => {
              const codigo = normalizarCodigo(plan.codigo);
              const esActual = codigo === planActual;
              const esDestacado = codigo === "pro";
              const precio = obtenerPrecio(plan, periodicidad);
              const caracteristicas = obtenerCaracteristicas(plan);

              return (
                <article
                  key={plan.id}
                  className={`plan-card ${
                    esDestacado ? "featured" : ""
                  } ${esActual ? "current" : ""}`}
                >
                  {esDestacado && (
                    <div className="featured-label">
                      <Crown size={13} />
                      MÁS ELEGIDO
                    </div>
                  )}

                  <div className="plan-card-top">
                    <span className="plan-icon">
                      {obtenerIcono(codigo)}
                    </span>

                    <div>
                      <span className="plan-code">
                        {codigo.toUpperCase()}
                      </span>
                      <h2>{plan.nombre || `EOS ${capitalizar(codigo)}`}</h2>
                    </div>
                  </div>

                  <p className="plan-description">
                    {plan.descripcion ||
                      "Capacidades de TransTech EOS adaptadas a este nivel."}
                  </p>

                  <div className="plan-price">
                    <strong>{precio.principal}</strong>
                    {precio.detalle && <span>{precio.detalle}</span>}
                  </div>

                  <button
                    type="button"
                    disabled={esActual || seleccionando === codigo}
                    onClick={() => seleccionarPlan(plan)}
                    className={`select-button ${
                      esDestacado ? "primary" : ""
                    }`}
                  >
                    {seleccionando === codigo ? (
                      <>
                        <Loader2 className="spin" size={16} />
                        Preparando...
                      </>
                    ) : esActual ? (
                      <>
                        <ShieldCheck size={16} />
                        Plan actual
                      </>
                    ) : codigo === "enterprise" ? (
                      <>
                        Hablar con ventas
                        <ArrowRight size={16} />
                      </>
                    ) : (
                      <>
                        Elegir plan
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>

                  <div className="divider" />

                  <span className="includes-label">ESTE PLAN INCLUYE</span>

                  <ul>
                    {caracteristicas.map((item) => (
                      <li key={item}>
                        <span>
                          <Check size={13} />
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </section>
        )}

        <section className="plans-guarantee">
          <span className="guarantee-icon">
            <Zap size={22} />
          </span>

          <div>
            <span className="plans-section-label">ACTIVACIÓN SEGURA</span>
            <h2>Tu acceso cambia cuando TransTech confirma el pago.</h2>
            <p>
              En pagos por transferencia, el comprobante pasa por revisión
              antes de activar el plan. Una vez confirmado, EOS actualiza tus
              límites y funciones disponibles.
            </p>
          </div>
        </section>

        <footer className="plans-footer">
          <span />
          Precios y capacidades obtenidos directamente desde TransTech EOS.
        </footer>
      </div>

      {mostrarContacto && (
        <div
          className="contact-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setMostrarContacto(false);
            }
          }}
        >
          <section
            className="contact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-title"
          >
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
                <span className="plans-section-label">SOLICITUD ENVIADA</span>
                <h2 id="contact-title">Ventas ya recibió tu consulta.</h2>
                <p>
                  Te responderemos al correo <strong>{contacto.email}</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => setMostrarContacto(false)}
                >
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
                    <span className="plans-section-label">
                      EOS ENTERPRISE
                    </span>
                    <h2 id="contact-title">Hablemos de tu organización.</h2>
                  </div>
                </div>

                <p className="contact-intro">
                  Completá tus datos y TransTech enviará automáticamente la
                  solicitud a ventas@transtech.com.py.
                </p>

                <form
                  className="contact-form"
                  onSubmit={enviarSolicitudEnterprise}
                >
                  <div className="contact-fields">
                    <label>
                      <span>Nombre *</span>
                      <input
                        value={contacto.nombre}
                        onChange={(event) =>
                          setContacto((actual) => ({
                            ...actual,
                            nombre: event.target.value,
                          }))
                        }
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
                        onChange={(event) =>
                          setContacto((actual) => ({
                            ...actual,
                            email: event.target.value,
                          }))
                        }
                        required
                        maxLength={180}
                        autoComplete="email"
                      />
                    </label>

                    <label>
                      <span>Empresa</span>
                      <input
                        value={contacto.empresa}
                        onChange={(event) =>
                          setContacto((actual) => ({
                            ...actual,
                            empresa: event.target.value,
                          }))
                        }
                        maxLength={160}
                        autoComplete="organization"
                      />
                    </label>

                    <label>
                      <span>Teléfono</span>
                      <input
                        value={contacto.telefono}
                        onChange={(event) =>
                          setContacto((actual) => ({
                            ...actual,
                            telefono: event.target.value,
                          }))
                        }
                        maxLength={50}
                        autoComplete="tel"
                      />
                    </label>
                  </div>

                  <label className="contact-message">
                    <span>¿Qué necesita tu organización?</span>
                    <textarea
                      value={contacto.mensaje}
                      onChange={(event) =>
                        setContacto((actual) => ({
                          ...actual,
                          mensaje: event.target.value,
                        }))
                      }
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
                      onChange={(event) =>
                        setContacto((actual) => ({
                          ...actual,
                          website: event.target.value,
                        }))
                      }
                    />
                  </label>

                  {errorContacto && (
                    <p className="contact-error">{errorContacto}</p>
                  )}

                  <button
                    type="submit"
                    className="contact-submit"
                    disabled={enviandoContacto}
                  >
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

                  <p className="contact-privacy">
                    Tus datos se utilizarán únicamente para responder esta
                    consulta comercial.
                  </p>
                </form>
              </>
            )}
          </section>
        </div>
      )}

      <style jsx>{`
        .plans-page {
          position: relative;
          min-height: 100vh;
          overflow: hidden;
          padding: 26px 28px 72px;
          background:
            linear-gradient(180deg, #ffffff 0%, #f5f9ff 52%, #edf4ff 100%);
          color: #071226;
          font-family: Inter, Arial, Helvetica, sans-serif;
        }

        .plans-grid {
          position: fixed;
          inset: 0;
          opacity: 0.35;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(15, 23, 42, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(15, 23, 42, 0.035) 1px, transparent 1px);
          background-size: 44px 44px;
          mask-image: linear-gradient(to bottom, black, transparent 90%);
        }

        .plans-glow {
          position: fixed;
          border-radius: 999px;
          pointer-events: none;
          filter: blur(120px);
        }

        .plans-glow-one {
          top: 100px;
          right: -120px;
          width: 560px;
          height: 560px;
          background: rgba(37, 99, 235, 0.13);
        }

        .plans-glow-two {
          bottom: -220px;
          left: 10%;
          width: 620px;
          height: 620px;
          background: rgba(96, 165, 250, 0.12);
        }

        .plans-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1460px;
          margin: 0 auto;
        }

        .plans-topbar {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 20px;
        }

        .back-button,
        .dashboard-button {
          min-height: 43px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          padding: 0 15px;
          border: 1px solid #dbe5f2;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.9);
          color: #334155;
          font-family: inherit;
          font-size: 11px;
          font-weight: 850;
          cursor: pointer;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .dashboard-button {
          justify-self: end;
          border-color: #bfdbfe;
          color: #2563eb;
        }

        .brand-lockup {
          display: grid;
          text-align: center;
        }

        .brand-lockup span {
          color: #2563eb;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.22em;
        }

        .brand-lockup strong {
          margin-top: 2px;
          color: #071226;
          font-size: 24px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: -0.05em;
        }

        .plans-hero {
          max-width: 900px;
          margin: 76px auto 0;
          text-align: center;
        }

        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #2563eb;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.17em;
        }

        .plans-hero h1 {
          margin: 20px 0 0;
          font-size: clamp(44px, 6.7vw, 82px);
          font-weight: 950;
          line-height: 0.98;
          letter-spacing: -0.062em;
        }

        .plans-hero p {
          max-width: 720px;
          margin: 25px auto 0;
          color: #64748b;
          font-size: 15px;
          line-height: 1.75;
        }

        .billing-toggle {
          width: fit-content;
          display: flex;
          gap: 5px;
          margin: 30px auto 0;
          padding: 5px;
          border: 1px solid #dbe5f2;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.07);
        }

        .billing-toggle button {
          min-height: 39px;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 0 16px;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: #64748b;
          font-family: inherit;
          font-size: 10px;
          font-weight: 850;
          cursor: pointer;
        }

        .billing-toggle button.active {
          background: #071226;
          color: white;
        }

        .billing-toggle button span {
          padding: 4px 7px;
          border-radius: 999px;
          background: #dbeafe;
          color: #2563eb;
          font-size: 8px;
        }

        .loading-card,
        .error-card {
          max-width: 620px;
          min-height: 180px;
          display: grid;
          place-content: center;
          gap: 12px;
          margin: 55px auto 0;
          padding: 30px;
          border: 1px solid #dbe5f2;
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.92);
          color: #64748b;
          text-align: center;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.07);
        }

        .error-card strong {
          color: #071226;
          font-size: 20px;
        }

        .error-card p {
          margin: 0;
          font-size: 12px;
        }

        .error-card button {
          width: fit-content;
          min-height: 40px;
          margin: 4px auto 0;
          padding: 0 17px;
          border: 0;
          border-radius: 999px;
          background: #2563eb;
          color: white;
          font-family: inherit;
          font-weight: 800;
          cursor: pointer;
        }

        .plans-grid-cards {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          align-items: stretch;
          gap: 14px;
          margin-top: 56px;
        }

        .plan-card {
          position: relative;
          min-width: 0;
          display: flex;
          flex-direction: column;
          padding: 25px 21px 23px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 27px;
          background: rgba(255, 255, 255, 0.93);
          box-shadow:
            0 20px 60px rgba(15, 23, 42, 0.07),
            inset 0 1px 0 rgba(255, 255, 255, 0.96);
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .plan-card:hover {
          transform: translateY(-5px);
          border-color: rgba(37, 99, 235, 0.27);
          box-shadow: 0 26px 68px rgba(37, 99, 235, 0.11);
        }

        .plan-card.featured {
          border-color: rgba(37, 99, 235, 0.5);
          background:
            linear-gradient(180deg, #071226 0%, #0b1a35 100%);
          color: white;
          box-shadow: 0 27px 80px rgba(7, 18, 38, 0.24);
        }

        .plan-card.current {
          box-shadow:
            0 0 0 2px rgba(34, 197, 94, 0.2),
            0 20px 60px rgba(15, 23, 42, 0.07);
        }

        .featured-label {
          position: absolute;
          top: -14px;
          left: 50%;
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transform: translateX(-50%);
          padding: 0 12px;
          border-radius: 999px;
          background: #2563eb;
          color: white;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: 0.1em;
          white-space: nowrap;
          box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3);
        }

        .plan-card-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .plan-icon {
          width: 45px;
          height: 45px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 15px;
          background: #eff6ff;
          color: #2563eb;
        }

        .featured .plan-icon {
          border: 1px solid rgba(255, 255, 255, 0.13);
          background: rgba(255, 255, 255, 0.08);
          color: #93c5fd;
        }

        .plan-code {
          color: #2563eb;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: 0.14em;
        }

        .featured .plan-code {
          color: #93c5fd;
        }

        .plan-card h2 {
          margin: 4px 0 0;
          color: #071226;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        .featured h2 {
          color: white;
        }

        .plan-description {
          min-height: 66px;
          margin: 20px 0 0;
          color: #64748b;
          font-size: 11px;
          line-height: 1.65;
        }

        .featured .plan-description {
          color: #bfdbfe;
        }

        .plan-price {
          min-height: 68px;
          display: flex;
          align-items: flex-end;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 15px;
        }

        .plan-price strong {
          color: #071226;
          font-size: 25px;
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .featured .plan-price strong {
          color: white;
        }

        .plan-price span {
          padding-bottom: 4px;
          color: #94a3b8;
          font-size: 9px;
          font-weight: 750;
        }

        .select-button {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 16px;
          border: 1px solid #bfdbfe;
          border-radius: 14px;
          background: #eff6ff;
          color: #2563eb;
          font-family: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            background 180ms ease;
        }

        .select-button:hover:not(:disabled) {
          transform: translateY(-2px);
          background: #dbeafe;
        }

        .select-button.primary {
          border-color: #2563eb;
          background: #2563eb;
          color: white;
          box-shadow: 0 13px 28px rgba(37, 99, 235, 0.24);
        }

        .select-button:disabled {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #15803d;
          cursor: default;
        }

        .featured .select-button:disabled {
          border-color: rgba(74, 222, 128, 0.25);
          background: rgba(34, 197, 94, 0.12);
          color: #86efac;
        }

        .divider {
          height: 1px;
          margin: 22px 0 18px;
          background: #e2e8f0;
        }

        .featured .divider {
          background: rgba(255, 255, 255, 0.11);
        }

        .includes-label {
          color: #94a3b8;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: 0.13em;
        }

        .plan-card ul {
          display: grid;
          gap: 11px;
          margin: 16px 0 0;
          padding: 0;
          list-style: none;
        }

        .plan-card li {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          color: #475569;
          font-size: 9px;
          font-weight: 700;
          line-height: 1.45;
        }

        .featured li {
          color: #dbeafe;
        }

        .plan-card li > span {
          width: 19px;
          height: 19px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          margin-top: -2px;
          border-radius: 7px;
          background: #eff6ff;
          color: #2563eb;
        }

        .featured li > span {
          background: rgba(255, 255, 255, 0.09);
          color: #93c5fd;
        }

        .plans-guarantee {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 18px;
          max-width: 900px;
          margin: 54px auto 0;
          padding: 28px;
          border-radius: 28px;
          background: #071226;
          color: white;
          box-shadow: 0 25px 75px rgba(7, 18, 38, 0.2);
        }

        .guarantee-icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(255, 255, 255, 0.13);
          border-radius: 17px;
          background: rgba(255, 255, 255, 0.08);
          color: #93c5fd;
        }

        .plans-section-label {
          color: #93c5fd;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.14em;
        }

        .plans-guarantee h2 {
          margin: 8px 0 0;
          font-size: 25px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        .plans-guarantee p {
          margin: 11px 0 0;
          color: #bfdbfe;
          font-size: 12px;
          line-height: 1.65;
        }

        .plans-footer {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          margin-top: 28px;
          color: #94a3b8;
          font-size: 9px;
          text-align: center;
        }

        .plans-footer span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 9px rgba(34, 197, 94, 0.5);
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
          border: 1px solid rgba(191, 219, 254, 0.75);
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
          border: 1px solid #dbe5f2;
          border-radius: 13px;
          background: #f8fafc;
          color: #64748b;
          cursor: pointer;
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
          background: #eff6ff;
          color: #2563eb;
        }

        .contact-heading h2,
        .contact-success h2 {
          margin: 8px 0 0;
          color: #071226;
          font-size: 29px;
          font-weight: 930;
          letter-spacing: -0.04em;
        }

        .contact-intro {
          margin: 18px 0 0;
          color: #64748b;
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

        .contact-form label {
          display: grid;
          gap: 7px;
        }

        .contact-form label > span {
          color: #334155;
          font-size: 9px;
          font-weight: 850;
        }

        .contact-form input,
        .contact-form textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #dbe5f2;
          border-radius: 13px;
          background: #f8fafc;
          color: #071226;
          font-family: inherit;
          font-size: 12px;
          outline: none;
          transition:
            border-color 160ms ease,
            box-shadow 160ms ease,
            background 160ms ease;
        }

        .contact-form input {
          min-height: 45px;
          padding: 0 13px;
        }

        .contact-form textarea {
          resize: vertical;
          min-height: 112px;
          padding: 12px 13px;
          line-height: 1.6;
        }

        .contact-form input:focus,
        .contact-form textarea:focus {
          border-color: #60a5fa;
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.09);
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
        .contact-success button {
          min-height: 47px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          margin-top: 17px;
          padding: 0 20px;
          border: 0;
          border-radius: 14px;
          background: #2563eb;
          color: #ffffff;
          font-family: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 14px 30px rgba(37, 99, 235, 0.22);
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
          color: #94a3b8;
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

        .contact-success p {
          margin: 14px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.65;
        }

        .spin {
          animation: spin 800ms linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1260px) {
          .plans-grid-cards {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 850px) {
          .plans-grid-cards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 620px) {
          .plans-page {
            padding: 18px 14px 50px;
          }

          .plans-topbar {
            grid-template-columns: 1fr 1fr;
          }

          .brand-lockup {
            display: none;
          }

          .plans-hero {
            margin-top: 58px;
          }

          .plans-hero h1 {
            font-size: clamp(42px, 14vw, 62px);
          }

          .plans-grid-cards {
            grid-template-columns: 1fr;
            gap: 20px;
          }

          .plans-guarantee {
            grid-template-columns: 1fr;
          }

          .contact-overlay {
            padding: 10px;
          }

          .contact-modal {
            max-height: calc(100vh - 20px);
            padding: 24px 17px;
            border-radius: 23px;
          }

          .contact-fields {
            grid-template-columns: 1fr;
          }

          .contact-heading h2,
          .contact-success h2 {
            font-size: 25px;
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
  const codigo = (value || "")
    .trim()
    .toLowerCase()
    .replace(/^eos\s+/, "");

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

function obtenerPrecio(
  plan: PlanRow,
  periodicidad: "mensual" | "anual",
) {
  const codigo = normalizarCodigo(plan.codigo);

  if (codigo === "free") {
    return { principal: "Gratis", detalle: "para comenzar" };
  }

  if (codigo === "enterprise") {
    return { principal: "Personalizado", detalle: "según alcance" };
  }

  const valor =
    periodicidad === "anual"
      ? plan.precio_anual_pyg
      : plan.precio_mensual_pyg;

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

function limiteVisible(
  valor: number | null | undefined,
  singular: string,
  plural: string,
) {
  if (valor === null || valor === undefined) return null;
  if (valor < 0) return `${plural} ilimitados`;
  if (valor === 0) return `Sin ${plural.toLowerCase()}`;
  return `${valor.toLocaleString("es-PY")} ${
    valor === 1 ? singular : plural
  }`;
}

function obtenerCaracteristicas(plan: PlanRow) {
  const codigo = normalizarCodigo(plan.codigo);

  const items = [
    limiteVisible(plan.limite_mensajes, "mensaje", "mensajes"),
    limiteVisible(plan.limite_excel, "Excel", "Excel"),
    limiteVisible(plan.limite_pdf, "PDF", "PDF"),
    limiteVisible(
      plan.limite_automatizaciones,
      "automatización",
      "automatizaciones",
    ),
    plan.memoria_dias === -1
      ? "Memoria contextual ilimitada"
      : plan.memoria_dias
        ? `${plan.memoria_dias} días de memoria contextual`
        : null,
    plan.limite_usuarios && plan.limite_usuarios > 1
      ? `Hasta ${plan.limite_usuarios} usuarios`
      : null,
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