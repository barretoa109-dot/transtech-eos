"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type PlanPago = {
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  precio_mensual_pyg: number | null;
  precio_anual_pyg: number | null;
};

type DatosComprador = {
  nombre: string;
  email: string;
  telefono: string;
  documento: string;
  ruc: string;
  razon_social: string;
};

const PLANES_PAGOS = new Set(["personal", "pro", "business"]);

export default function PagoCheckout() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const planCodigo = (searchParams.get("plan") || "")
    .trim()
    .toLowerCase();

  const periodicidad =
    searchParams.get("periodicidad") === "anual"
      ? "anual"
      : "mensual";

  const [plan, setPlan] = useState<PlanPago | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");

  const [comprador, setComprador] = useState<DatosComprador>({
    nombre: "",
    email: "",
    telefono: "",
    documento: "",
    ruc: "",
    razon_social: "",
  });

  useEffect(() => {
    let activo = true;

    async function cargarCheckout() {
      setCargando(true);
      setError("");

      try {
        if (!PLANES_PAGOS.has(planCodigo)) {
          throw new Error("El plan seleccionado no es válido.");
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          const destino = `/pago?plan=${encodeURIComponent(
            planCodigo,
          )}&periodicidad=${periodicidad}`;

          router.replace(
            `/login?redirect=${encodeURIComponent(destino)}`,
          );

          return;
        }

        if (activo) {
          setComprador((actual) => ({
            ...actual,
            nombre:
              user.user_metadata?.nombre ||
              user.user_metadata?.name ||
              actual.nombre,
            email: user.email || actual.email,
            telefono:
              user.user_metadata?.telefono ||
              user.user_metadata?.phone ||
              actual.telefono,
          }));
        }

        const {
          data: planData,
          error: planError,
        } = await supabase
          .from("planes")
          .select(
            `
              codigo,
              nombre,
              descripcion,
              precio_mensual_pyg,
              precio_anual_pyg
            `,
          )
          .eq("codigo", planCodigo)
          .eq("activo", true)
          .eq("es_publico", true)
          .maybeSingle();

        if (planError || !planData) {
          throw new Error(
            "No pudimos cargar el plan seleccionado.",
          );
        }

        if (activo) {
          setPlan(planData as PlanPago);
        }
      } catch (err) {
        console.error("No se pudo cargar el checkout:", err);

        if (activo) {
          setError(
            err instanceof Error
              ? err.message
              : "No pudimos preparar el pago.",
          );
        }
      } finally {
        if (activo) {
          setCargando(false);
        }
      }
    }

    cargarCheckout();

    return () => {
      activo = false;
    };
  }, [
    periodicidad,
    planCodigo,
    router,
    supabase,
  ]);

  function actualizarCampo(
    campo: keyof DatosComprador,
    valor: string,
  ) {
    setComprador((actual) => ({
      ...actual,
      [campo]: valor,
    }));
  }

  async function continuarPago(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setProcesando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/pagos/crear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan: planCodigo,
          periodicidad,
          ...comprador,
        }),
      });

      const resultado = await respuesta
        .json()
        .catch(() => null);

      if (!respuesta.ok) {
        throw new Error(
          resultado?.error ||
            "No se pudo crear el pedido.",
        );
      }

      if (!resultado?.checkout_url) {
        throw new Error(
          "PagoPar no devolvió la URL del checkout.",
        );
      }

      window.location.assign(resultado.checkout_url);
    } catch (err) {
      console.error("No se pudo iniciar el pago:", err);

      setError(
        err instanceof Error
          ? err.message
          : "No se pudo continuar con PagoPar.",
      );

      setProcesando(false);
    }
  }

  const monto =
    periodicidad === "anual"
      ? plan?.precio_anual_pyg
      : plan?.precio_mensual_pyg;

  const montoFormateado =
    monto !== null &&
    monto !== undefined
      ? new Intl.NumberFormat("es-PY", {
          maximumFractionDigits: 0,
        }).format(monto)
      : "0";

  return (
    <main className="payment-page">
      <div className="payment-grid" />
      <div className="payment-glow payment-glow-one" />
      <div className="payment-glow payment-glow-two" />

      <div className="payment-container">
        <header className="payment-topbar">
          <button
            type="button"
            className="back-button"
            onClick={() => router.push("/planes")}
          >
            <ArrowLeft size={17} />
            Volver a planes
          </button>

          <div className="brand-lockup">
            <span>TRANSTECH</span>
            <strong>EOS</strong>
          </div>

          <div className="secure-label">
            <ShieldCheck size={16} />
            CHECKOUT SEGURO
          </div>
        </header>

        {cargando ? (
          <section className="state-card">
            <Loader2 className="spin" size={27} />
            <strong>Preparando tu compra...</strong>
          </section>
        ) : error && !plan ? (
          <section className="state-card error-state">
            <strong>No pudimos abrir el checkout</strong>
            <p>{error}</p>

            <button
              type="button"
              onClick={() => router.push("/planes")}
            >
              Volver a planes
            </button>
          </section>
        ) : (
          <section className="payment-layout">
            <article className="buyer-card">
              <div className="section-heading">
                <span className="section-icon">
                  <Sparkles size={20} />
                </span>

                <div>
                  <span className="eyebrow">
                    DATOS DEL COMPRADOR
                  </span>

                  <h1>Confirmá tu suscripción.</h1>
                </div>
              </div>

              <p className="intro">
                Completá tus datos para generar el pedido.
                PagoPar procesará el pago en su entorno seguro.
              </p>

              <form onSubmit={continuarPago}>
                <div className="fields-grid">
                  <label>
                    <span>Nombre completo *</span>
                    <input
                      required
                      maxLength={120}
                      autoComplete="name"
                      value={comprador.nombre}
                      onChange={(event) =>
                        actualizarCampo(
                          "nombre",
                          event.target.value,
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Correo de tu cuenta *</span>
                    <input
                      required
                      readOnly
                      type="email"
                      autoComplete="email"
                      value={comprador.email}
                    />
                  </label>

                  <label>
                    <span>Teléfono *</span>
                    <input
                      required
                      maxLength={40}
                      autoComplete="tel"
                      placeholder="0981 000 000"
                      value={comprador.telefono}
                      onChange={(event) =>
                        actualizarCampo(
                          "telefono",
                          event.target.value,
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Cédula o documento *</span>
                    <input
                      required
                      maxLength={40}
                      inputMode="numeric"
                      placeholder="1234567"
                      value={comprador.documento}
                      onChange={(event) =>
                        actualizarCampo(
                          "documento",
                          event.target.value,
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>RUC</span>
                    <input
                      maxLength={40}
                      placeholder="Opcional"
                      value={comprador.ruc}
                      onChange={(event) =>
                        actualizarCampo(
                          "ruc",
                          event.target.value,
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Razón social</span>
                    <input
                      maxLength={160}
                      autoComplete="organization"
                      placeholder="Opcional"
                      value={comprador.razon_social}
                      onChange={(event) =>
                        actualizarCampo(
                          "razon_social",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </div>

                {error && (
                  <p className="payment-error">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  className="pay-button"
                  disabled={procesando}
                >
                  {procesando ? (
                    <>
                      <Loader2
                        className="spin"
                        size={18}
                      />
                      Creando pedido...
                    </>
                  ) : (
                    <>
                      <CreditCard size={18} />
                      Continuar con PagoPar
                    </>
                  )}
                </button>

                <p className="security-note">
                  <LockKeyhole size={13} />
                  Tus claves de PagoPar nunca se exponen en
                  el navegador.
                </p>
              </form>
            </article>

            <aside className="summary-card">
              <span className="eyebrow">
                RESUMEN DEL PEDIDO
              </span>

              <h2>
                {plan?.nombre ||
                  `EOS ${planCodigo}`}
              </h2>

              <p className="summary-description">
                {plan?.descripcion ||
                  "Suscripción a TransTech EOS."}
              </p>

              <div className="price">
                <strong>
                  Gs. {montoFormateado}
                </strong>

                <span>
                  /
                  {periodicidad === "anual"
                    ? "año"
                    : "mes"}
                </span>
              </div>

              <div className="period-row">
                <span>Facturación</span>
                <strong>
                  {periodicidad === "anual"
                    ? "Anual"
                    : "Mensual"}
                </strong>
              </div>

              <div className="summary-divider" />

              <ul>
                <li>
                  <span>
                    <Check size={13} />
                  </span>
                  Precio validado directamente en
                  Supabase
                </li>

                <li>
                  <span>
                    <Check size={13} />
                  </span>
                  Activación automática al confirmarse
                  el pago
                </li>

                <li>
                  <span>
                    <Check size={13} />
                  </span>
                  Registro completo en el historial de
                  pagos
                </li>
              </ul>

              <div className="provider-box">
                <ShieldCheck size={20} />

                <div>
                  <strong>Pago procesado por PagoPar</strong>
                  <span>
                    TransTech EOS no almacena los datos
                    de tu tarjeta.
                  </span>
                </div>
              </div>
            </aside>
          </section>
        )}
      </div>

      <style jsx>{`
        .payment-page {
          position: relative;
          min-height: 100vh;
          overflow: hidden;
          padding: 26px 28px 70px;
          background:
            linear-gradient(
              180deg,
              #ffffff 0%,
              #f5f9ff 52%,
              #edf4ff 100%
            );
          color: #071226;
          font-family:
            Inter, Arial, Helvetica, sans-serif;
        }

        .payment-grid {
          position: fixed;
          inset: 0;
          opacity: 0.34;
          pointer-events: none;
          background-image:
            linear-gradient(
              rgba(15, 23, 42, 0.035) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              rgba(15, 23, 42, 0.035) 1px,
              transparent 1px
            );
          background-size: 44px 44px;
          mask-image: linear-gradient(
            to bottom,
            black,
            transparent 92%
          );
        }

        .payment-glow {
          position: fixed;
          border-radius: 999px;
          pointer-events: none;
          filter: blur(120px);
        }

        .payment-glow-one {
          top: 90px;
          right: -130px;
          width: 560px;
          height: 560px;
          background: rgba(37, 99, 235, 0.13);
        }

        .payment-glow-two {
          bottom: -220px;
          left: 8%;
          width: 620px;
          height: 620px;
          background: rgba(96, 165, 250, 0.12);
        }

        .payment-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1160px;
          margin: 0 auto;
        }

        .payment-topbar {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 20px;
        }

        .back-button {
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

        .secure-label {
          justify-self: end;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #15803d;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.12em;
        }

        .payment-layout {
          display: grid;
          grid-template-columns:
            minmax(0, 1.2fr)
            minmax(340px, 0.8fr);
          align-items: start;
          gap: 22px;
          margin-top: 60px;
        }

        .buyer-card,
        .summary-card,
        .state-card {
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 29px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow:
            0 24px 70px rgba(15, 23, 42, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.96);
        }

        .buyer-card {
          padding: 34px;
        }

        .summary-card {
          padding: 31px;
          background:
            linear-gradient(
              180deg,
              #071226 0%,
              #0b1a35 100%
            );
          color: white;
          box-shadow: 0 27px 80px rgba(7, 18, 38, 0.24);
        }

        .section-heading {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .section-icon {
          width: 49px;
          height: 49px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 16px;
          background: #eff6ff;
          color: #2563eb;
        }

        .eyebrow {
          color: #2563eb;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.14em;
        }

        .summary-card .eyebrow {
          color: #93c5fd;
        }

        h1 {
          margin: 8px 0 0;
          font-size: clamp(32px, 5vw, 48px);
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .intro {
          max-width: 620px;
          margin: 20px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.7;
        }

        form {
          margin-top: 27px;
        }

        .fields-grid {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        label {
          display: grid;
          gap: 7px;
        }

        label span {
          color: #334155;
          font-size: 9px;
          font-weight: 850;
        }

        input {
          min-height: 48px;
          width: 100%;
          box-sizing: border-box;
          padding: 0 13px;
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

        input:focus {
          border-color: #60a5fa;
          background: white;
          box-shadow: 0 0 0 4px
            rgba(37, 99, 235, 0.09);
        }

        input:read-only {
          color: #64748b;
          cursor: default;
        }

        .payment-error {
          margin: 15px 0 0;
          padding: 12px 13px;
          border: 1px solid #fecaca;
          border-radius: 12px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 10px;
          font-weight: 750;
        }

        .pay-button {
          width: 100%;
          min-height: 50px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          margin-top: 20px;
          border: 0;
          border-radius: 14px;
          background: #2563eb;
          color: white;
          font-family: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 14px 30px
            rgba(37, 99, 235, 0.22);
        }

        .pay-button:disabled {
          opacity: 0.65;
          cursor: wait;
        }

        .security-note {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 6px;
          margin: 11px 0 0;
          color: #94a3b8;
          font-size: 8px;
          text-align: center;
        }

        .summary-card h2 {
          margin: 13px 0 0;
          font-size: 29px;
          font-weight: 930;
          letter-spacing: -0.04em;
        }

        .summary-description {
          min-height: 58px;
          margin: 12px 0 0;
          color: #bfdbfe;
          font-size: 11px;
          line-height: 1.65;
        }

        .price {
          display: flex;
          align-items: flex-end;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 25px;
        }

        .price strong {
          color: white;
          font-size: 33px;
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .price span {
          padding-bottom: 5px;
          color: #93c5fd;
          font-size: 10px;
          font-weight: 750;
        }

        .period-row {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          margin-top: 22px;
          padding: 14px 15px;
          border: 1px solid
            rgba(255, 255, 255, 0.11);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.055);
        }

        .period-row span {
          color: #bfdbfe;
          font-size: 10px;
        }

        .period-row strong {
          color: white;
          font-size: 10px;
        }

        .summary-divider {
          height: 1px;
          margin: 24px 0 20px;
          background: rgba(255, 255, 255, 0.11);
        }

        .summary-card ul {
          display: grid;
          gap: 13px;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .summary-card li {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          color: #dbeafe;
          font-size: 10px;
          line-height: 1.5;
        }

        .summary-card li > span {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          margin-top: -2px;
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.09);
          color: #93c5fd;
        }

        .provider-box {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 11px;
          margin-top: 25px;
          padding: 16px;
          border: 1px solid
            rgba(147, 197, 253, 0.18);
          border-radius: 16px;
          background: rgba(37, 99, 235, 0.11);
          color: #93c5fd;
        }

        .provider-box div {
          display: grid;
          gap: 5px;
        }

        .provider-box strong {
          color: white;
          font-size: 10px;
        }

        .provider-box span {
          color: #bfdbfe;
          font-size: 9px;
          line-height: 1.5;
        }

        .state-card {
          min-height: 280px;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 12px;
          max-width: 650px;
          margin: 70px auto 0;
          padding: 30px;
          color: #64748b;
          text-align: center;
        }

        .state-card strong {
          color: #071226;
          font-size: 21px;
        }

        .state-card p {
          margin: 0;
          color: #64748b;
          font-size: 12px;
        }

        .state-card button {
          min-height: 42px;
          margin-top: 4px;
          padding: 0 17px;
          border: 0;
          border-radius: 999px;
          background: #2563eb;
          color: white;
          font-family: inherit;
          font-weight: 850;
          cursor: pointer;
        }

        .spin {
          animation: spin 800ms linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 850px) {
          .payment-layout {
            grid-template-columns: 1fr;
          }

          .summary-card {
            order: -1;
          }
        }

        @media (max-width: 620px) {
          .payment-page {
            padding: 18px 14px 50px;
          }

          .payment-topbar {
            grid-template-columns: 1fr 1fr;
          }

          .brand-lockup {
            display: none;
          }

          .secure-label {
            font-size: 8px;
          }

          .payment-layout {
            margin-top: 42px;
          }

          .buyer-card,
          .summary-card {
            padding: 24px 18px;
            border-radius: 24px;
          }

          .fields-grid {
            grid-template-columns: 1fr;
          }

          h1 {
            font-size: 35px;
          }
        }
      `}</style>
    </main>
  );
}