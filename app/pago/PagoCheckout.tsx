"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Check,
  Clipboard,
  Loader2,
  Headphones,
  ListChecks,
  Mail,
  ShieldCheck,
  Upload,
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

type PedidoCreado = {
  solicitud_id: string;
  referencia: string;
  monto: number;
};

const PLANES_PAGOS = new Set(["personal", "pro", "business"]);

const CUENTA = {
  banco: "Banco Continental S.A.E.C.A.",
  titular: "TRANSTECH E.A.S.",
  numero: "060061320004",
  ruc: "80174259-5",
  moneda: "Guaraníes",
};

export default function PagoCheckout() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const planCodigo = (searchParams.get("plan") || "").trim().toLowerCase();
  const periodicidad =
    searchParams.get("periodicidad") === "anual" ? "anual" : "mensual";

  const [plan, setPlan] = useState<PlanPago | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const [pedido, setPedido] = useState<PedidoCreado | null>(null);
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [copiado, setCopiado] = useState("");

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

          router.replace(`/login?redirect=${encodeURIComponent(destino)}`);
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

        const { data: planData, error: planError } = await supabase
          .from("planes")
          .select(
            "codigo,nombre,descripcion,precio_mensual_pyg,precio_anual_pyg",
          )
          .eq("codigo", planCodigo)
          .eq("activo", true)
          .eq("es_publico", true)
          .maybeSingle();

        if (planError || !planData) {
          throw new Error("No pudimos cargar el plan seleccionado.");
        }

        if (activo) setPlan(planData as PlanPago);
      } catch (err) {
        if (activo) {
          setError(
            err instanceof Error ? err.message : "No pudimos preparar el pago.",
          );
        }
      } finally {
        if (activo) setCargando(false);
      }
    }

    cargarCheckout();

    return () => {
      activo = false;
    };
  }, [periodicidad, planCodigo, router, supabase]);

  function actualizarCampo(campo: keyof DatosComprador, valor: string) {
    setComprador((actual) => ({ ...actual, [campo]: valor }));
  }

  async function crearPedido(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcesando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/pagos/crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planCodigo,
          periodicidad,
          ...comprador,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(resultado?.error || "No se pudo crear el pedido.");
      }

      setPedido({
        solicitud_id: resultado.solicitud_id,
        referencia: resultado.referencia,
        monto: resultado.monto,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo crear el pedido.",
      );
    } finally {
      setProcesando(false);
    }
  }

  async function subirComprobante() {
    if (!pedido || !comprobante) {
      setError("Seleccioná el comprobante antes de continuar.");
      return;
    }

    setSubiendo(true);
    setError("");

    try {
      const formData = new FormData();
      formData.set("solicitud_id", pedido.solicitud_id);
      formData.set("comprobante", comprobante);

      const respuesta = await fetch("/api/pagos/comprobante", {
        method: "POST",
        body: formData,
      });

      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(resultado?.error || "No se pudo subir el comprobante.");
      }

      router.push(
        `/pago/resultado?solicitud=${encodeURIComponent(pedido.solicitud_id)}`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo subir el comprobante.",
      );
    } finally {
      setSubiendo(false);
    }
  }

  async function copiar(texto: string, etiqueta: string) {
    await navigator.clipboard.writeText(texto);
    setCopiado(etiqueta);
    window.setTimeout(() => setCopiado(""), 1600);
  }

  async function copiarTodosLosDatos() {
    if (!pedido) return;

    const datos = [
      `Banco: ${CUENTA.banco}`,
      `Titular: ${CUENTA.titular}`,
      `Número de cuenta: ${CUENTA.numero}`,
      `RUC: ${CUENTA.ruc}`,
      `Moneda: ${CUENTA.moneda}`,
      `Monto: Gs. ${montoFormateado}`,
      `Referencia: ${pedido.referencia}`,
    ].join("\n");

    await copiar(datos, "Todos los datos");
  }

  const monto =
    periodicidad === "anual"
      ? plan?.precio_anual_pyg
      : plan?.precio_mensual_pyg;

  const montoReal = pedido?.monto ?? monto ?? 0;
  const montoFormateado = new Intl.NumberFormat("es-PY", {
    maximumFractionDigits: 0,
  }).format(montoReal);

  return (
    <main className="payment-page">
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
            PAGO SEGURO
          </div>
        </header>

        {cargando ? (
          <section className="state-card">
            <Loader2 className="spin" size={27} />
            <strong>Preparando tu compra...</strong>
          </section>
        ) : error && !plan ? (
          <section className="state-card">
            <strong>No pudimos abrir el checkout</strong>
            <p>{error}</p>
          </section>
        ) : !pedido ? (
          <section className="payment-layout">
            <article className="buyer-card">
              <span className="eyebrow">PASO 1 DE 2</span>
              <h1>Confirmá tu suscripción.</h1>
              <p className="intro">
                Completá tus datos. Después te mostraremos los datos bancarios de TRANSTECH E.A.S. para realizar la transferencia.
              </p>

              <form onSubmit={crearPedido}>
                <div className="fields-grid">
                  <label>
                    <span>Nombre completo *</span>
                    <input
                      required
                      maxLength={120}
                      autoComplete="name"
                      value={comprador.nombre}
                      onChange={(e) => actualizarCampo("nombre", e.target.value)}
                    />
                  </label>

                  <label>
                    <span>Correo de tu cuenta *</span>
                    <input
                      required
                      readOnly
                      type="email"
                      value={comprador.email}
                    />
                  </label>

                  <label>
                    <span>Teléfono *</span>
                    <input
                      required
                      maxLength={40}
                      placeholder="0981 000 000"
                      value={comprador.telefono}
                      onChange={(e) =>
                        actualizarCampo("telefono", e.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Cédula o documento *</span>
                    <input
                      required
                      maxLength={40}
                      inputMode="numeric"
                      value={comprador.documento}
                      onChange={(e) =>
                        actualizarCampo("documento", e.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>RUC</span>
                    <input
                      maxLength={40}
                      placeholder="Opcional"
                      value={comprador.ruc}
                      onChange={(e) => actualizarCampo("ruc", e.target.value)}
                    />
                  </label>

                  <label>
                    <span>Razón social</span>
                    <input
                      maxLength={160}
                      placeholder="Opcional"
                      value={comprador.razon_social}
                      onChange={(e) =>
                        actualizarCampo("razon_social", e.target.value)
                      }
                    />
                  </label>
                </div>

                {error && <p className="payment-error">{error}</p>}

                <button
                  type="submit"
                  className="pay-button"
                  disabled={procesando}
                >
                  {procesando ? (
                    <>
                      <Loader2 className="spin" size={18} />
                      Generando pedido...
                    </>
                  ) : (
                    <>
                      <Building2 size={18} />
                      Ver datos para transferir
                    </>
                  )}
                </button>
              </form>
            </article>

            <Resumen
              plan={plan}
              planCodigo={planCodigo}
              periodicidad={periodicidad}
              montoFormateado={montoFormateado}
            />
          </section>
        ) : (
          <section className="transfer-layout">
            <article className="transfer-card">
              <span className="eyebrow">PASO 2 DE 2</span>
              <h1>Realizá la transferencia.</h1>
              <p className="intro">
                Transferí exactamente <strong>Gs. {montoFormateado}</strong> y
                luego subí el comprobante.
              </p>

              <div className="reference">
                <span>Referencia del pedido</span>
                <strong>{pedido.referencia}</strong>
              </div>

              <div className="bank-grid">
                <div className="instructions-box">
                  <div className="instructions-icon">
                    <ListChecks size={24} />
                  </div>

                  <div>
                    <span className="instructions-label">
                      INSTRUCCIONES
                    </span>

                    <h2>Cómo realizar el pago</h2>
                  </div>

                  <ol>
                    <li>Abrí la aplicación de tu banco.</li>
                    <li>
                      Transferí exactamente{" "}
                      <strong>Gs. {montoFormateado}</strong>.
                    </li>
                    <li>
                      Usá los datos bancarios de TRANSTECH E.A.S.
                    </li>
                    <li>
                      Subí el comprobante para solicitar la activación.
                    </li>
                  </ol>

                  <button
                    type="button"
                    className="copy-all-button"
                    onClick={copiarTodosLosDatos}
                  >
                    <Clipboard size={16} />
                    Copiar todos los datos
                  </button>
                </div>

                <div className="bank-data">
                  <Dato
                    titulo="Banco"
                    valor={CUENTA.banco}
                    onCopiar={() => copiar(CUENTA.banco, "Banco")}
                  />
                  <Dato
                    titulo="Titular"
                    valor={CUENTA.titular}
                    onCopiar={() => copiar(CUENTA.titular, "Titular")}
                  />
                  <Dato
                    titulo="Número de cuenta"
                    valor={CUENTA.numero}
                    onCopiar={() => copiar(CUENTA.numero, "Cuenta")}
                  />
                  <Dato
                    titulo="RUC"
                    valor={CUENTA.ruc}
                    onCopiar={() => copiar(CUENTA.ruc, "RUC")}
                  />
                  <Dato titulo="Moneda" valor={CUENTA.moneda} />
                </div>
              </div>

              {copiado && (
                <p className="copied">Copiado: {copiado}</p>
              )}

              <div className="upload-box">
                <Upload size={24} />
                <div>
                  <strong>Subí tu comprobante</strong>
                  <span>JPG, PNG, WEBP o PDF. Máximo 8 MB.</span>
                </div>

                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setComprobante(e.target.files?.[0] || null)}
                />
              </div>

              {comprobante && (
                <p className="selected-file">
                  Archivo seleccionado: <strong>{comprobante.name}</strong>
                </p>
              )}

              {error && <p className="payment-error">{error}</p>}

              <button
                type="button"
                className="pay-button"
                disabled={subiendo || !comprobante}
                onClick={subirComprobante}
              >
                {subiendo ? (
                  <>
                    <Loader2 className="spin" size={18} />
                    Enviando comprobante...
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    Enviar para verificación
                  </>
                )}
              </button>

              <p className="security-note">
                El plan se activa después de verificar que el pago ingresó.
              </p>

              <div className="support-box">
                <div className="support-icon">
                  <Headphones size={22} />
                </div>

                <div className="support-copy">
                  <strong>¿Necesitás ayuda?</strong>
                  <span>Contactá con nuestro equipo de soporte.</span>
                </div>

                <a
                  className="support-email"
                  href="mailto:soporte@transtech.com.py?subject=Ayuda con pago de TransTech EOS"
                >
                  <span className="support-email-icon">
                    <Mail size={18} />
                  </span>

                  <span>
                    <strong>soporte@transtech.com.py</strong>
                    <small>
                      Respondemos normalmente en menos de 24 horas hábiles.
                    </small>
                  </span>
                </a>
              </div>
            </article>
          </section>
        )}
      </div>

      <style jsx>{`
        .payment-page {
          min-height: 100vh;
          padding: 26px 28px 70px;
          background:
            radial-gradient(circle at 88% 12%, rgba(37, 99, 235, 0.12), transparent 28%),
            linear-gradient(180deg, #ffffff 0%, #f5f9ff 52%, #edf4ff 100%);
          color: #071226;
          font-family: Inter, Arial, Helvetica, sans-serif;
        }

        .payment-container {
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
          width: fit-content;
          min-height: 43px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 15px;
          border: 1px solid #dbe5f2;
          border-radius: 999px;
          background: white;
          color: #334155;
          font-weight: 850;
          cursor: pointer;
        }

        .brand-lockup {
          display: grid;
          text-align: center;
        }

        .brand-lockup span,
        .eyebrow {
          color: #2563eb;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.18em;
        }

        .brand-lockup strong {
          font-size: 24px;
          font-weight: 950;
        }

        .secure-label {
          justify-self: end;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #15803d;
          font-size: 9px;
          font-weight: 950;
        }

        .payment-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
          gap: 22px;
          margin-top: 60px;
        }

        .buyer-card,
        .summary-card,
        .transfer-card,
        .state-card {
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 29px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08);
        }

        .buyer-card,
        .transfer-card {
          padding: 34px;
        }

        .summary-card {
          padding: 31px;
          background: linear-gradient(180deg, #071226 0%, #0b1a35 100%);
          color: white;
        }

        .transfer-layout {
          max-width: 880px;
          margin: 58px auto 0;
        }

        h1 {
          margin: 9px 0 0;
          font-size: clamp(34px, 5vw, 48px);
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .intro {
          color: #64748b;
          font-size: 13px;
          line-height: 1.7;
        }

        .fields-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-top: 25px;
        }

        label {
          display: grid;
          gap: 7px;
        }

        label span {
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
        }

        .pay-button {
          width: 100%;
          min-height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          margin-top: 20px;
          border: 0;
          border-radius: 14px;
          background: #2563eb;
          color: white;
          font-weight: 900;
          cursor: pointer;
        }

        .pay-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .summary-card h2 {
          margin: 13px 0 0;
          font-size: 29px;
        }

        .summary-card p,
        .summary-card li {
          color: #bfdbfe;
          font-size: 10px;
          line-height: 1.6;
        }

        .price strong {
          display: inline-block;
          margin-top: 20px;
          font-size: 33px;
        }

        .summary-card ul {
          display: grid;
          gap: 12px;
          padding: 0;
          list-style: none;
        }

        .summary-card li {
          display: flex;
          gap: 8px;
        }

        .reference {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin: 24px 0;
          padding: 17px 18px;
          border: 1px solid #dbe5f2;
          border-radius: 14px;
          background: #f8fafc;
          font-size: 12px;
        }

        .reference span {
          color: #334155;
          font-weight: 750;
        }

        .reference strong {
          color: #071226;
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 0.01em;
          overflow-wrap: anywhere;
          text-align: right;
        }

        .bank-grid {
          display: grid;
          grid-template-columns: minmax(240px, 0.85fr) minmax(0, 1.15fr);
          gap: 20px;
          align-items: start;
        }

        .instructions-box {
          display: grid;
          align-content: start;
          gap: 15px;
          padding: 22px;
          border: 1px solid #dbe5f2;
          border-radius: 20px;
          background:
            linear-gradient(180deg, #071226 0%, #0b1a35 100%);
          color: white;
          box-shadow: 0 20px 45px rgba(7, 18, 38, 0.16);
        }

        .instructions-icon {
          width: 46px;
          height: 46px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: rgba(96, 165, 250, 0.14);
          color: #93c5fd;
        }

        .instructions-label {
          color: #93c5fd;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: 0.16em;
        }

        .instructions-box h2 {
          margin: 7px 0 0;
          font-size: 23px;
          letter-spacing: -0.035em;
        }

        .instructions-box ol {
          display: grid;
          gap: 12px;
          margin: 2px 0 0;
          padding-left: 20px;
          color: #dbeafe;
          font-size: 11px;
          line-height: 1.6;
        }

        .copy-all-button {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 4px;
          border: 1px solid rgba(147, 197, 253, 0.2);
          border-radius: 13px;
          background: rgba(37, 99, 235, 0.18);
          color: white;
          font-family: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }

        .bank-data {
          display: grid;
          gap: 10px;
        }

        .upload-box {
          position: relative;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 13px;
          align-items: center;
          margin-top: 24px;
          padding: 20px;
          border: 1.5px dashed #93c5fd;
          border-radius: 18px;
          background: #eff6ff;
          color: #2563eb;
        }

        .upload-box div {
          display: grid;
          gap: 4px;
        }

        .upload-box span {
          color: #64748b;
          font-size: 10px;
        }

        .upload-box input {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
        }

        .payment-error {
          padding: 12px 13px;
          border: 1px solid #fecaca;
          border-radius: 12px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 10px;
        }

        .copied,
        .selected-file,
        .security-note {
          color: #64748b;
          font-size: 9px;
          text-align: center;
        }

        .support-box {
          display: grid;
          grid-template-columns: auto minmax(180px, 0.7fr) minmax(300px, 1.3fr);
          align-items: center;
          gap: 16px;
          margin-top: 25px;
          padding: 18px;
          border: 1px solid #dbe5f2;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 12px 35px rgba(15, 23, 42, 0.05);
        }

        .support-icon,
        .support-email-icon {
          display: grid;
          place-items: center;
          color: #2563eb;
          background: #eff6ff;
        }

        .support-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
        }

        .support-copy {
          display: grid;
          gap: 4px;
        }

        .support-copy strong {
          color: #071226;
          font-size: 15px;
          font-weight: 900;
        }

        .support-copy span {
          color: #64748b;
          font-size: 11px;
        }

        .support-email {
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 12px;
          padding-left: 16px;
          border-left: 1px solid #dbe5f2;
          color: inherit;
          text-decoration: none;
        }

        .support-email-icon {
          width: 46px;
          height: 46px;
          border-radius: 13px;
        }

        .support-email > span:last-child {
          min-width: 0;
          display: grid;
          gap: 5px;
        }

        .support-email strong {
          color: #2563eb;
          font-size: 14px;
          font-weight: 900;
          overflow-wrap: anywhere;
        }

        .support-email small {
          color: #64748b;
          font-size: 10px;
          line-height: 1.45;
        }

        .support-email:hover strong {
          text-decoration: underline;
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
        }

        .spin {
          animation: spin 800ms linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 850px) {
          .payment-layout,
          .bank-grid {
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

          .buyer-card,
          .summary-card,
          .transfer-card {
            padding: 24px 18px;
          }

          .fields-grid {
            grid-template-columns: 1fr;
          }

          .reference {
            display: grid;
          }

          .reference strong {
            text-align: left;
          }

          .support-box {
            grid-template-columns: auto 1fr;
          }

          .support-email {
            grid-column: 1 / -1;
            padding-top: 15px;
            padding-left: 0;
            border-top: 1px solid #dbe5f2;
            border-left: 0;
          }
        }
      `}</style>
    </main>
  );
}

function Resumen({
  plan,
  planCodigo,
  periodicidad,
  montoFormateado,
}: {
  plan: PlanPago | null;
  planCodigo: string;
  periodicidad: string;
  montoFormateado: string;
}) {
  return (
    <aside className="summary-card">
      <span className="eyebrow">RESUMEN DEL PEDIDO</span>
      <h2>{plan?.nombre || `EOS ${planCodigo}`}</h2>
      <p>{plan?.descripcion || "Suscripción a TransTech EOS."}</p>
      <div className="price">
        <strong>Gs. {montoFormateado}</strong>
      </div>
      <p>Facturación {periodicidad === "anual" ? "anual" : "mensual"}</p>
      <ul>
        <li><Check size={14} /> Precio validado en la plataforma</li>
        <li><Building2 size={14} /> Transferencia a cuenta empresarial</li>
        <li><ShieldCheck size={14} /> Activación posterior a la verificación</li>
      </ul>
    </aside>
  );
}

function Dato({
  titulo,
  valor,
  onCopiar,
}: {
  titulo: string;
  valor: string;
  onCopiar?: () => void;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: "12px",
      alignItems: "center",
      padding: "13px 14px",
      border: "1px solid #dbe5f2",
      borderRadius: "14px",
      background: "#f8fafc",
    }}>
      <div style={{ display: "grid", gap: "4px", minWidth: 0 }}>
        <span style={{
          color: "#94a3b8",
          fontSize: "10px",
          fontWeight: 900,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}>{titulo}</span>
        <strong style={{ fontSize: "17px", fontWeight: 900, lineHeight: 1.25, overflowWrap: "anywhere" }}>
          {valor}
        </strong>
      </div>
      {onCopiar && (
        <button
          type="button"
          onClick={onCopiar}
          aria-label={`Copiar ${titulo}`}
          style={{
            width: "36px",
            height: "36px",
            display: "grid",
            placeItems: "center",
            border: "1px solid #dbe5f2",
            borderRadius: "10px",
            background: "white",
            color: "#2563eb",
            cursor: "pointer",
          }}
        >
          <Clipboard size={15} />
        </button>
      )}
    </div>
  );
}
