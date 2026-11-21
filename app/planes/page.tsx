"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, Check, Layers, Loader2, Mail, MessageCircle, Send, Wallet, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AmbientBackground from "@/components/effects/AmbientBackground";
import { planesTechCanvas } from "@/components/effects/techCanvasPresets";
import { useNavScrolled } from "@/components/effects/useNavScrolled";
import {
  esCodigoPlan,
  MENSAJES_GRATIS_POR_DIA,
  PLANES,
  precioDelPlan,
  type CodigoPlan,
} from "@/lib/modulos/planes";

/**
 * Planes y precios.
 *
 * ============================================================
 * CUATRO PLANES (v263)
 * ============================================================
 *
 * El 20/11/2026 el dueño cambió "armá tu EOS" por cuatro planes cerrados:
 * Gratis, Finanzas Personales, Emprendedor / Empresas y Full. En una prueba
 * con 100 clientes simulados, los que compraban pasaron de 18 a 32 con estos
 * cuatro precios frente al armador.
 *
 * Los precios de esta pantalla salen de `lib/modulos/planes.ts` y NO cobran:
 * el que cobra es `eos_paquetes`, en la base. `planes.test.ts` los compara.
 *
 * Ningún plan dice "ilimitado", "sin tope" ni "sin límite": todos tienen un
 * tope interno y al cliente no se le promete lo contrario.
 *
 * ============================================================
 * NADA DE `<Link>` CON CLASES DE ESTE ARCHIVO
 * ============================================================
 *
 * styled-jsx no estila componentes propios: las clases se aplican al elemento
 * generado y el componente las pierde. Se rompe SOLO en producción. Los
 * enlaces con estilo usan `:global(.btn)`.
 */

const PERIODOS = [
  { clave: "mensual" as const, etiqueta: "Mensual" },
  { clave: "anual" as const, etiqueta: "Anual" },
];

const ICONOS: Record<CodigoPlan, typeof Wallet> = {
  finanzas_personales: Wallet,
  emprendedor: Briefcase,
  full: Layers,
};

/**
 * El plan que había tocado antes de que lo mandáramos a iniciar sesión.
 *
 * Se lee de `window` y no con `useSearchParams`, que arrastraría la página
 * entera al cliente y dejaría el HTML del servidor vacío para Google y para
 * un teléfono lento.
 */
function pedidoDeLaUrl(): { plan: CodigoPlan; periodicidad: "mensual" | "anual" } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const plan = params.get("plan");
  if (!esCodigoPlan(plan)) return null;
  return { plan, periodicidad: params.get("periodo") === "anual" ? "anual" : "mensual" };
}

export default function PlanesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const scrolled = useNavScrolled();

  const [periodicidad, setPeriodicidad] = useState<"mensual" | "anual">("mensual");
  const [planActual, setPlanActual] = useState<CodigoPlan | null>(null);
  /** Días que le quedan de la prueba de un mes (v264), o null si no está probando. */
  const [diasDePrueba, setDiasDePrueba] = useState<number | null>(null);
  const [enviando, setEnviando] = useState<CodigoPlan | null>(null);
  const [error, setError] = useState("");
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

  async function contratar(plan: CodigoPlan, periodo: "mensual" | "anual" = periodicidad) {
    if (enviando) return;

    setEnviando(plan);
    setError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // El plan viaja en la URL para que volver del login siga la compra.
        const destino = `/planes?plan=${plan}&periodo=${periodo}`;
        router.push(`/login?redirect=${encodeURIComponent(destino)}`);
        return;
      }

      const respuesta = await fetch("/api/modulos/armado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, periodicidad: periodo }),
      });

      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok || !resultado?.armado_id) {
        throw new Error(resultado?.error || "No pudimos guardar tu plan.");
      }

      /*
       * Directo a la transferencia, que desde el 2026-11-16 es la única forma
       * de pago: Bancard está en pausa. El día que la tarjeta vuelva
       * (`BANCARD_PAUSADO=0`), esto vuelve a `/pago/tarjeta`.
       */
      router.push(`/pago?armado=${encodeURIComponent(resultado.armado_id)}`);
    } catch (err) {
      console.error("No se pudo preparar el pago del plan:", err);
      setError(err instanceof Error ? err.message : "No pudimos preparar el pago.");
      setEnviando(null);
    }
  }

  useEffect(() => {
    let activo = true;
    const pedido = pedidoDeLaUrl();

    async function cargar() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !activo) return;

      setContacto((actual) => ({
        ...actual,
        nombre: actual.nombre || user.user_metadata?.nombre || user.user_metadata?.name || "",
        email: actual.email || user.email || "",
      }));

      // Volvió del login con un plan elegido: se sigue la compra donde quedó.
      if (pedido) {
        setPeriodicidad(pedido.periodicidad);
        void contratar(pedido.plan, pedido.periodicidad);
        return;
      }

      // La política de RLS solo deja leer los armados propios.
      const { data } = await supabase
        .from("eos_planes_armados")
        .select("paquete")
        .eq("estado", "vigente")
        .maybeSingle();

      const paquete = (data as { paquete?: unknown } | null)?.paquete;
      if (activo && esCodigoPlan(paquete)) setPlanActual(paquete);

      const mios = await fetch("/api/modulos", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      const dias = ((mios?.modulos ?? []) as { origen?: string; contratado?: boolean; dias_restantes?: number | null }[])
        .filter((m) => m.contratado && m.origen === "prueba" && typeof m.dias_restantes === "number")
        .reduce<number | null>((max, m) => (max === null || m.dias_restantes! > max ? m.dias_restantes! : max), null);
      if (activo && dias !== null && dias > 0) setDiasDePrueba(dias);
    }

    cargar().catch((err) => console.error("Planes: no se pudo leer el plan actual:", err));

    return () => {
      activo = false;
    };
    // `contratar` se usa una sola vez, al volver del login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

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
          origen: "planes",
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
        <h1 className="head-title">Un plan para tu plata, otro para tu negocio, o los dos.</h1>
        <p className="head-sub">
          Al crear tu cuenta tenés un mes del plan Full gratis, sin tarjeta. Después elegís el plan
          que te sirva, o seguís en Gratis.
        </p>
        <div className="toggle-wrap">
          <div className="toggle">
            {PERIODOS.map((p) => (
              <button
                key={p.clave}
                type="button"
                className={periodicidad === p.clave ? "active" : ""}
                onClick={() => setPeriodicidad(p.clave)}
                aria-pressed={periodicidad === p.clave}
              >
                {p.etiqueta}
                {p.clave === "anual" && <span className="badge">2 meses gratis</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wrap">
        {diasDePrueba !== null && (
          <p className="plans-prueba">
            Estás probando EOS Full gratis: te{" "}
            {diasDePrueba === 1 ? "queda 1 día" : `quedan ${diasDePrueba} días`}. Si elegís un plan
            ahora, los días que te quedan se suman.
          </p>
        )}

        {error && (
          <p className="plans-error" role="alert">
            {error}
          </p>
        )}

        <div className="plans">
          <article className="plan">
            <div className="plan-ic">
              <MessageCircle />
            </div>
            <div className="plan-tag">Para probar</div>
            <h2 className="plan-name">Gratis</h2>
            <p className="plan-desc">Conocé EOS sin tarjeta y sin compromiso.</p>
            <div className="plan-price">
              Gs. 0 <span className="per">{periodicidad === "anual" ? "/ año" : "/ mes"}</span>
            </div>
            <div className="plan-price-sub">Sin tarjeta</div>
            <a className="plan-btn" href="/eos">
              Empezar gratis
            </a>
            <div className="plan-includes-label">Incluye</div>
            <div className="plan-feat">
              <Check />
              {MENSAJES_GRATIS_POR_DIA} mensajes por día con EOS
            </div>
            <div className="plan-feat">
              <Check />
              Panel de tu plata
            </div>
            <div className="plan-feat">
              <Check />
              Tu primer mes, todo Full gratis
            </div>
          </article>

          {PLANES.map((plan) => {
            const Icono = ICONOS[plan.codigo];
            const actual = planActual === plan.codigo;
            const precio = precioDelPlan(plan, periodicidad);

            return (
              <article key={plan.codigo} className={`plan ${plan.destacado ? "premium" : ""}`}>
                {plan.destacado && <div className="plan-badge">Recomendado para negocios</div>}
                <div className="plan-ic">
                  <Icono />
                </div>
                <div className="plan-tag">{plan.codigo === "full" ? "Todo junto" : plan.codigo === "emprendedor" ? "Tu negocio" : "Tu plata"}</div>
                <h2 className="plan-name">{plan.nombre}</h2>
                <p className="plan-desc">{plan.para}</p>
                <div className="plan-price">
                  {formatearGs(precio)}{" "}
                  <span className="per">{periodicidad === "anual" ? "/ año" : "/ mes"}</span>
                </div>
                <div className="plan-price-sub">
                  {periodicidad === "anual"
                    ? `Equivale a ${formatearGs(Math.round(precio / 12))} por mes`
                    : `${formatearGs(plan.precio_anual_pyg)} pagando el año`}
                </div>
                <button
                  type="button"
                  className={`plan-btn ${actual ? "current" : "primary"}`}
                  disabled={actual || enviando !== null}
                  onClick={() => contratar(plan.codigo)}
                  aria-label={`${actual ? "Tu plan actual" : "Elegir"} ${plan.nombre}, ${formatearGs(precio)} ${
                    periodicidad === "anual" ? "por año" : "por mes"
                  }`}
                >
                  {enviando === plan.codigo ? (
                    <>
                      <Loader2 className="spin" />
                      Preparando...
                    </>
                  ) : actual ? (
                    "Tu plan actual"
                  ) : (
                    "Elegir este plan"
                  )}
                </button>
                <div className="plan-includes-label">Incluye</div>
                {plan.incluye.map((item) => (
                  <div className="plan-feat" key={item}>
                    <Check />
                    {item}
                  </div>
                ))}
              </article>
            );
          })}
        </div>

        <div className="empresa-caja">
          <div>
            <strong>¿Necesitás algo a medida para tu organización?</strong>
            <p>Integraciones propias, muchos usuarios o facturación a nombre de tu empresa.</p>
          </div>
          <button
            type="button"
            className="plan-btn fantasma"
            onClick={() => {
              setContactoEnviado(false);
              setErrorContacto("");
              setMostrarContacto(true);
            }}
          >
            Hablar con ventas →
          </button>
        </div>

        <p className="note">
          Precios en guaraníes. El plan Finanzas Personales es
          para tu plata personal: los gastos y ventas de un negocio van en Emprendedor / Empresas o
          en Full.
        </p>
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
                    <span className="section-label">EOS PARA EMPRESAS</span>
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

                  {errorContacto && <p className="contact-error" role="alert">{errorContacto}</p>}

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


        .plans {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        .planes-page :global(.plan) {
          padding: 28px 22px;
        }
        .plans .plan-price {
          font-size: 26px;
          white-space: nowrap;
        }
        a.plan-btn {
          box-sizing: border-box;
        }
        .plan-btn:disabled:not(.current) {
          opacity: 0.6;
          cursor: wait;
        }
        .plan-btn.fantasma {
          width: auto;
          margin: 0;
          padding: 12px 18px;
          color: var(--blue-dark);
        }
        .plans-prueba {
          max-width: 620px;
          margin: 0 auto 24px;
          padding: 11px 14px;
          border-radius: 12px;
          background: var(--green-light);
          color: var(--green);
          font-size: 13px;
          font-weight: 600;
          text-align: center;
        }
        .plans-error {
          max-width: 620px;
          margin: 0 auto 24px;
          padding: 11px 14px;
          border: 1px solid #fecaca;
          border-radius: 12px;
          background: #fef2f2;
          color: #b42318;
          font-size: 13px;
          text-align: center;
        }
        .empresa-caja {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
          margin: 0 0 36px;
          padding: 20px 22px;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: var(--surface);
        }
        .empresa-caja p {
          margin: 4px 0 0;
          font-size: 13px;
          color: var(--muted);
        }
        @media (max-width: 1100px) {
          .plans {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 640px) {
          .plans {
            grid-template-columns: 1fr;
          }
          .head-title {
            font-size: 32px;
          }
          .wrap {
            padding: 0 16px;
          }
        }
      `}</style>
    </main>
  );
}

function formatearGs(valor: number) {
  return `Gs. ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(valor)}`;
}
