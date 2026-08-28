"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Mail, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AmbientBackground from "@/components/effects/AmbientBackground";
import { planesTechCanvas } from "@/components/effects/techCanvasPresets";
import { useNavScrolled } from "@/components/effects/useNavScrolled";
import {
  calcularArmado,
  MESES_DEL_ANUAL,
  TOPE_MENSUAL_PYG,
  type ModuloCatalogo,
} from "@/lib/modulos/armado";

/**
 * Armá tu EOS.
 *
 * ============================================================
 * POR QUÉ ACÁ YA NO HAY PLANES
 * ============================================================
 *
 * Había cinco escalones y cada uno era una apuesta sobre qué combinación de
 * funciones quiere la gente. La apuesta fallaba siempre igual: el que solo
 * quería conversar más tenía que pagar un panel financiero que no usa, y el que
 * solo quería el panel tenía que pagar mensajes que no iba a mandar.
 *
 * Ahora cada función tiene precio y el usuario prende las que quiere. La cuenta
 * se ve cambiar mientras elige, y hay un techo: prendas lo que prendas, no
 * pagás más de Gs. 500.000.
 *
 * ============================================================
 * DOS DETALLES QUE NO SON DETALLE
 * ============================================================
 *
 * 1. **El total de esta pantalla no cobra.** Se calcula acá para que el número
 *    responda al instante, pero el que cobra es `eos_precio_armado`, en la
 *    base. Si los dos no coinciden, manda la base — y por eso el servidor
 *    ignora cualquier total que le mande el navegador.
 *
 * 2. **Nada de `<Link>` con clases de este archivo.** styled-jsx no estila
 *    componentes propios: las clases se aplican al elemento generado y el
 *    componente las pierde. Se rompe SOLO en producción, así que se descubre
 *    tarde. Los enlaces con estilo usan `:global(.btn)`, que ya existía por
 *    exactamente el mismo motivo.
 */

type ModuloContratado = {
  codigo: string;
  contratado?: boolean;
};

const PERIODOS = [
  { clave: "mensual" as const, etiqueta: "Mensual" },
  { clave: "anual" as const, etiqueta: "Anual" },
];

/**
 * Lo que ya había elegido antes de que lo mandáramos a iniciar sesión.
 *
 * Sin esto, quien arma su EOS, toca "contratar" y no tiene sesión vuelve del
 * login a una pantalla en blanco y tiene que volver a elegir todo: el momento
 * exacto en el que la gente abandona una compra.
 *
 * ============================================================
 * POR QUÉ NO SE USA useSearchParams
 * ============================================================
 *
 * Porque arrastra al cliente todo lo que cuelgue de él. Cuando colgaba la
 * página entera, el HTML que servía el servidor traía TRECE caracteres
 * visibles: ni Google ni un teléfono lento veían nada hasta que cargaba el
 * JavaScript — en la página donde se vende el producto.
 *
 * El parámetro solo importa al volver del login, que pasa siempre en el
 * navegador. Leerlo acá da lo mismo y deja la página prerenderizada entera.
 */
function elegidasDeLaUrl(): string[] {
  if (typeof window === "undefined") return [];

  return (new URLSearchParams(window.location.search).get("elegidas") ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export default function PlanesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const scrolled = useNavScrolled();

  const [catalogo, setCatalogo] = useState<ModuloCatalogo[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [contratados, setContratados] = useState<string[]>([]);
  const [periodicidad, setPeriodicidad] = useState<"mensual" | "anual">("mensual");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
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
    const elegidasEnLaUrl = elegidasDeLaUrl();

    async function cargarCatalogo() {
      setCargando(true);
      setError("");

      try {
        const respuesta = await fetch("/api/modulos/catalogo", { cache: "no-store" });
        if (!respuesta.ok) throw new Error("catálogo no disponible");

        const payload = (await respuesta.json()) as { modulos: ModuloCatalogo[] };
        if (!activo) return;

        setCatalogo(payload.modulos ?? []);

        /*
         * Lo que ya tiene contratado viene marcado, y arranca prendido.
         *
         * Alguien que entra a agregar una función no puede tener que volver a
         * elegir todo lo que ya paga: si el armado arrancara vacío, el primer
         * clic en "pagar" le cancelaría en la práctica lo que ya tenía.
         */
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          // Sin sesión, un punto de partida razonable: conversar y ver su plata.
          if (activo) {
            setSeleccion(
              elegidasEnLaUrl.length > 0 ? elegidasEnLaUrl : ["conversaciones", "dashboard"],
            );
          }
          return;
        }

        if (activo) {
          setContacto((actual) => ({
            ...actual,
            nombre: actual.nombre || user.user_metadata?.nombre || user.user_metadata?.name || "",
            email: actual.email || user.email || "",
          }));
        }

        const mios = await fetch("/api/modulos", { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);

        const activos = ((mios?.modulos ?? []) as ModuloContratado[])
          .filter((m) => m.contratado)
          .map((m) => m.codigo);

        if (!activo) return;

        setContratados(activos);
        setSeleccion(
          elegidasEnLaUrl.length > 0
            ? [...new Set([...activos, ...elegidasEnLaUrl])]
            : activos.length > 0
              ? activos
              : ["conversaciones", "dashboard"],
        );
      } catch (err) {
        console.error("No se pudo cargar el catálogo de funciones:", err);
        if (activo) setError("No pudimos cargar las funciones en este momento. Volvé a intentarlo.");
      } finally {
        if (activo) setCargando(false);
      }
    }

    cargarCatalogo();

    return () => {
      activo = false;
    };
  }, [supabase]);

  const armado = useMemo(
    () => calcularArmado(seleccion, catalogo, periodicidad),
    [seleccion, catalogo, periodicidad],
  );

  const elegido = useCallback((codigo: string) => armado.modulos.includes(codigo), [armado.modulos]);

  /**
   * Prender o apagar una función.
   *
   * En los grupos de alternativas —los tramos de conversaciones— elegir uno
   * reemplaza al otro en vez de sumarse, y volver a tocar el que ya estaba
   * apaga el grupo entero. Es lo que uno espera de un grupo de opciones, y
   * evita que alguien termine pagando dos tramos de lo mismo.
   */
  function alternar(modulo: ModuloCatalogo) {
    setSeleccion((actual) => {
      const yaEstaba = actual.includes(modulo.codigo);

      if (!modulo.grupo) {
        return yaEstaba ? actual.filter((c) => c !== modulo.codigo) : [...actual, modulo.codigo];
      }

      const hermanos = catalogo.filter((m) => m.grupo === modulo.grupo).map((m) => m.codigo);
      const sinElGrupo = actual.filter((c) => !hermanos.includes(c));

      return yaEstaba ? sinElGrupo : [...sinElGrupo, modulo.codigo];
    });
  }

  async function irAPagar() {
    if (armado.modulos.length === 0 || enviando) return;

    setEnviando(true);
    setError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // La selección viaja en la URL para que volver del login no la pierda.
        const destino = `/planes?elegidas=${encodeURIComponent(armado.modulos.join(","))}`;
        router.push(`/login?redirect=${encodeURIComponent(destino)}`);
        return;
      }

      const respuesta = await fetch("/api/modulos/armado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modulos: armado.modulos, periodicidad }),
      });

      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok || !resultado?.armado_id) {
        throw new Error(resultado?.error || "No pudimos guardar tu selección.");
      }

      /*
       * Al checkout de TARJETA, que es el camino principal y ofrece la
       * transferencia como alternativa. Mandar directo a transferencia haría
       * que el que quiere pagar con tarjeta —la mayoría— tenga que buscar cómo.
       */
      router.push(`/pago/tarjeta?armado=${encodeURIComponent(resultado.armado_id)}`);
    } catch (err) {
      console.error("No se pudo preparar el pago del armado:", err);
      setError(err instanceof Error ? err.message : "No pudimos preparar el pago.");
    } finally {
      setEnviando(false);
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

  const grupos = agruparCatalogo(catalogo);

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
        <h1 className="head-title">Armá el EOS que vas a usar. Pagá solo eso.</h1>
        <p className="head-sub">
          Prendé las funciones que te sirven y apagá las que no. La cuenta se actualiza sola, y
          nunca pasa de {formatearGs(TOPE_MENSUAL_PYG)} por mes, tengas todo prendido o casi todo.
        </p>
        <div className="toggle-wrap">
          <div className="toggle">
            {PERIODOS.map((p) => (
              <button
                key={p.clave}
                type="button"
                className={periodicidad === p.clave ? "active" : ""}
                onClick={() => setPeriodicidad(p.clave)}
              >
                {p.etiqueta}
                {p.clave === "anual" && <span className="badge">2 meses gratis</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wrap">
        {cargando ? (
          <div className="state-card">
            <Loader2 className="spin" size={24} />
            Cargando funciones...
          </div>
        ) : catalogo.length === 0 ? (
          <div className="state-card">
            <strong>No se pudieron cargar las funciones</strong>
            <p>{error || "Volvé a intentarlo en un momento."}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          </div>
        ) : (
          <div className="armador">
            <div className="armador-lista">
              {grupos.map((grupo) => (
                <section className="bloque" key={grupo.clave}>
                  <h2 className="bloque-titulo">{grupo.titulo}</h2>
                  <p className="bloque-sub">{grupo.sub}</p>

                  <div className="opciones">
                    {grupo.modulos.map((modulo) => {
                      const activo = elegido(modulo.codigo);
                      const agregado = armado.agregados.includes(modulo.codigo);
                      const yaLoTiene = contratados.includes(modulo.codigo);

                      return (
                        <button
                          type="button"
                          key={modulo.codigo}
                          className={`opcion ${activo ? "activa" : ""}`}
                          onClick={() => alternar(modulo)}
                          aria-pressed={activo}
                          // El nombre accesible no se arma solo: el texto vive en
                          // spans anidados y un lector de pantalla anuncia el botón
                          // sin decir qué función es ni cuánto sale.
                          aria-label={`${modulo.nombre}, ${formatearGs(modulo.precio_mensual_pyg)} por mes`}
                        >
                          <span className={`marca ${activo ? "marcada" : ""}`}>
                            {activo && <Check size={13} />}
                          </span>

                          <span className="opcion-texto">
                            <span className="opcion-nombre">
                              {modulo.nombre}
                              {yaLoTiene && <span className="pill">ya lo tenés</span>}
                              {agregado && !yaLoTiene && <span className="pill">necesaria</span>}
                            </span>
                            <span className="opcion-desc">{modulo.descripcion}</span>
                          </span>

                          <span className="opcion-precio">
                            {precioVisible(modulo.precio_mensual_pyg, periodicidad)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <aside className="cuenta">
              <div className="cuenta-caja">
                {/*
                  Se llama por su nombre.

                  Comercialmente hay dos cosas y nada en el medio: el plan Free
                  con el que se prueba, y el EOS Personalizado que cada uno arma.
                  Ningún paquete cerrado, ninguna combinación sugerida como
                  producto. El tope de Gs. 500.000 es la única frontera.
                */}
                <span className="cuenta-eyebrow">EOS PERSONALIZADO</span>

                {armado.modulos.length === 0 ? (
                  <p className="cuenta-vacia">
                    Sin nada prendido seguís en <strong>EOS Free</strong>: 5 mensajes por día
                    para probar, sin costo y sin tarjeta. Prendé una función cuando quieras
                    más.
                  </p>
                ) : (
                  <ul className="cuenta-lista">
                    {armado.modulos.map((codigo) => {
                      const modulo = catalogo.find((m) => m.codigo === codigo);
                      if (!modulo) return null;

                      return (
                        <li key={codigo}>
                          <span>{modulo.nombre}</span>
                          <span>{precioVisible(modulo.precio_mensual_pyg, periodicidad)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {armado.tope_aplicado && (
                  <p className="cuenta-tope">
                    Sumaba {formatearGs(armado.subtotal)}. Se te cobra el tope.
                  </p>
                )}

                <div className="cuenta-total">
                  <span>Total</span>
                  <strong>{formatearGs(armado.total)}</strong>
                </div>
                <div className="cuenta-periodo">
                  {periodicidad === "anual" ? "por año" : "por mes"}
                </div>

                {error && <p className="cuenta-error">{error}</p>}

                <button
                  type="button"
                  className="cuenta-btn"
                  disabled={armado.modulos.length === 0 || enviando}
                  onClick={irAPagar}
                >
                  {enviando ? (
                    <>
                      <Loader2 className="spin" size={14} />
                      Preparando...
                    </>
                  ) : contratados.length > 0 ? (
                    "Actualizar mi EOS →"
                  ) : (
                    "Contratar →"
                  )}
                </button>

                <p className="cuenta-nota">
                  Podés cambiar tu selección cuando quieras. Lo que ya pagaste no se pierde.
                </p>
              </div>

              <div className="cuenta-caja secundaria">
                <span className="cuenta-eyebrow">¿SOS UNA EMPRESA?</span>
                <p className="cuenta-vacia">
                  Si necesitás varios usuarios, integraciones propias o facturación a nombre de tu
                  organización, hablamos.
                </p>
                <button
                  type="button"
                  className="cuenta-btn fantasma"
                  onClick={() => {
                    setContactoEnviado(false);
                    setErrorContacto("");
                    setMostrarContacto(true);
                  }}
                >
                  Hablar con ventas →
                </button>
              </div>
            </aside>
          </div>
        )}

        <p className="note">
          Precios en guaraníes, calculados por EOS al momento de contratar.
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
                  Volver a las funciones
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

        /* ============================================================
           EL ARMADOR

           Dos columnas: la lista de funciones a la izquierda y la cuenta a la
           derecha, pegada al scroll. En el teléfono la cuenta se va abajo: el
           precio es la única información que el usuario necesita ver mientras
           prende y apaga cosas.
           ============================================================ */
        .armador {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 28px;
          align-items: start;
        }

        .bloque {
          margin-bottom: 26px;
        }
        .bloque-titulo {
          margin: 0;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: -0.2px;
        }
        .bloque-sub {
          margin: 3px 0 12px;
          font-size: 13px;
          color: var(--muted);
        }

        .opciones {
          display: grid;
          gap: 8px;
        }
        .opcion {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          width: 100%;
          padding: 14px 16px;
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          transition: border-color 0.18s var(--ease), background 0.18s var(--ease),
            box-shadow 0.18s var(--ease);
        }
        .opcion:hover {
          border-color: var(--border-hover);
          background: var(--surface);
        }
        .opcion.activa {
          border-color: var(--blue);
          background: var(--blue-light);
          box-shadow: 0 1px 0 rgba(22, 86, 189, 0.08);
        }

        .marca {
          flex: none;
          width: 19px;
          height: 19px;
          margin-top: 1px;
          border: 1.5px solid var(--border);
          border-radius: 6px;
          background: var(--bg);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }
        .marca.marcada {
          background: var(--blue);
          border-color: var(--blue);
        }

        .opcion-texto {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .opcion-nombre {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 14px;
          font-weight: 700;
        }
        .opcion-desc {
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--muted);
        }
        .pill {
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--green-light);
          color: var(--green);
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.2px;
          text-transform: uppercase;
        }

        .opcion-precio {
          flex: none;
          font-size: 13.5px;
          font-weight: 800;
          color: var(--blue-dark);
          font-variant-numeric: tabular-nums;
        }

        .cuenta {
          position: sticky;
          top: 92px;
          display: grid;
          gap: 12px;
        }
        .cuenta-caja {
          padding: 18px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--bg);
          box-shadow: 0 10px 30px rgba(7, 19, 42, 0.05);
        }
        .cuenta-caja.secundaria {
          box-shadow: none;
          background: var(--surface);
        }
        .cuenta-eyebrow {
          display: block;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.6px;
          color: var(--muted);
        }
        .cuenta-vacia {
          margin: 10px 0 0;
          font-size: 13px;
          line-height: 1.5;
          color: var(--muted);
        }
        .cuenta-lista {
          list-style: none;
          margin: 12px 0 0;
          padding: 0;
          display: grid;
          gap: 6px;
        }
        .cuenta-lista li {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 12.5px;
          color: var(--muted);
        }
        .cuenta-lista li span:last-child {
          font-variant-numeric: tabular-nums;
          color: var(--text);
        }
        .cuenta-tope {
          margin: 10px 0 0;
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--green-light);
          color: var(--green);
          font-size: 12px;
          font-weight: 600;
        }
        .cuenta-total {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
          font-size: 13px;
          font-weight: 700;
        }
        .cuenta-total strong {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
          font-variant-numeric: tabular-nums;
        }
        .cuenta-periodo {
          text-align: right;
          font-size: 11.5px;
          color: var(--muted);
        }
        .cuenta-error {
          margin: 10px 0 0;
          font-size: 12.5px;
          color: #b42318;
        }
        .cuenta-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          margin-top: 14px;
          padding: 12px 16px;
          border: none;
          border-radius: 10px;
          background: var(--blue);
          color: #fff;
          font-size: 13.5px;
          font-weight: 700;
          transition: background 0.18s var(--ease), opacity 0.18s var(--ease);
        }
        .cuenta-btn:hover:not(:disabled) {
          background: var(--blue-dark);
        }
        .cuenta-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .cuenta-btn.fantasma {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--blue-dark);
        }
        .cuenta-btn.fantasma:hover {
          background: var(--bg);
          border-color: var(--blue);
        }
        .cuenta-nota {
          margin: 10px 0 0;
          font-size: 11.5px;
          line-height: 1.5;
          color: var(--muted);
        }

        @media (max-width: 900px) {
          .armador {
            grid-template-columns: 1fr;
          }
          .cuenta {
            position: static;
          }
        }

      `}</style>
    </main>
  );
}

/**
 * Cómo se agrupan las funciones en la pantalla.
 *
 * No es el orden del catálogo: es el orden en que alguien decide. Primero
 * "¿cuánto voy a hablar con EOS?", que es la única pregunta que casi todos se
 * hacen; después la plata, que es el corazón del producto; y al final las
 * herramientas de negocio, que solo miran los que las necesitan.
 *
 * Los grupos salen de los códigos y no de una columna de la base a propósito:
 * es una decisión de presentación, no del catálogo. Un módulo nuevo cae en
 * "Para tu negocio" hasta que alguien decida dónde va mejor, y eso es un cambio
 * de una línea acá y no una migración.
 */
function agruparCatalogo(catalogo: ModuloCatalogo[]) {
  const de = (codigos: string[]) =>
    catalogo.filter((m) => codigos.includes(m.codigo)).sort((a, b) => a.orden - b.orden);

  const conversaciones = catalogo
    .filter((m) => m.grupo === "conversaciones")
    .sort((a, b) => a.orden - b.orden);

  const dinero = de(["dashboard", "lectura", "alertas", "documentos", "briefing", "decisiones"]);

  const ubicados = new Set([...conversaciones, ...dinero].map((m) => m.codigo));
  const negocio = catalogo
    .filter((m) => !ubicados.has(m.codigo))
    .sort((a, b) => a.orden - b.orden);

  return [
    {
      clave: "conversaciones",
      titulo: "Hablar con EOS",
      sub: "Elegí un tramo, o ninguno si solo querés que EOS trabaje de fondo.",
      modulos: conversaciones,
    },
    {
      clave: "dinero",
      titulo: "Tu plata",
      sub: "Lo que EOS mira, lee y te avisa sin que le preguntes.",
      modulos: dinero,
    },
    {
      clave: "negocio",
      titulo: "Para tu negocio",
      sub: "Gestión completa, conectada a lo que EOS ya sabe de vos.",
      modulos: negocio,
    },
  ].filter((grupo) => grupo.modulos.length > 0);
}

/**
 * El precio de una función, como se lee en la lista.
 *
 * Una función que hoy no se cobra dice "Incluida" y no "Gs. 0": el cero se lee
 * como un error de la pantalla, y encima invita a preguntarse si va a empezar a
 * costar sin aviso. "Incluida" dice lo mismo sin las dos dudas.
 */
function precioVisible(mensual: number, periodicidad: "mensual" | "anual") {
  if (mensual <= 0) return "Incluida";

  return formatearGs(periodicidad === "anual" ? mensual * MESES_DEL_ANUAL : mensual);
}

function formatearGs(valor?: number | null) {
  if (valor === null || valor === undefined) return "";

  return `Gs. ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(valor)}`;
}
