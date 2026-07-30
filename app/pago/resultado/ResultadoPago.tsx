"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type EstadoVista =
  | "cargando"
  | "pagado"
  | "pendiente"
  | "cancelado"
  | "error";

type RespuestaConsulta = {
  ok?: boolean;
  error?: string;
  solicitud?: {
    plan_codigo?: string;
    periodicidad?: string;
    monto?: number;
    estado?: string;
    pagado_at?: string | null;
  };
  pagopar?: {
    pagado?: boolean;
    cancelado?: boolean;
    mensaje_resultado_pago?: {
      titulo?: string;
      descripcion?: string;
    };
    forma_pago?: string;
    fecha_pago?: string;
  } | null;
};

export default function ResultadoPago() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hash =
    searchParams.get("hash") ||
    searchParams.get("h") ||
    "";

  const [estado, setEstado] =
    useState<EstadoVista>("cargando");

  const [mensaje, setMensaje] = useState(
    "Estamos consultando el estado real del pedido.",
  );

  const [detalle, setDetalle] =
    useState<RespuestaConsulta | null>(null);

  useEffect(() => {
    let activo = true;

    async function consultarPago() {
      if (!hash) {
        setEstado("error");
        setMensaje(
          "No recibimos el identificador del pedido.",
        );
        return;
      }

      try {
        const respuesta = await fetch(
          "/api/pagos/consultar",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ hash }),
          },
        );

        const resultado =
          (await respuesta
            .json()
            .catch(() => null)) as RespuestaConsulta | null;

        if (!respuesta.ok) {
          throw new Error(
            resultado?.error ||
              "No pudimos verificar el pago.",
          );
        }

        if (!activo) return;

        setDetalle(resultado);

        const pagado =
          resultado?.pagopar?.pagado === true ||
          resultado?.solicitud?.estado === "pagado";

        const cancelado =
          resultado?.pagopar?.cancelado === true ||
          resultado?.solicitud?.estado === "cancelado" ||
          resultado?.solicitud?.estado === "vencido";

        if (pagado) {
          setEstado("pagado");
          setMensaje(
            "El pago fue confirmado y tu plan de TransTech EOS ya está activo.",
          );
          return;
        }

        if (cancelado) {
          setEstado("cancelado");
          setMensaje(
            resultado?.pagopar?.mensaje_resultado_pago
              ?.titulo ||
              "El pedido fue cancelado o ya no está disponible.",
          );
          return;
        }

        setEstado("pendiente");
        setMensaje(
          resultado?.pagopar?.mensaje_resultado_pago
            ?.titulo ||
            "El pedido todavía está pendiente de confirmación.",
        );
      } catch (error) {
        if (!activo) return;

        setEstado("error");
        setMensaje(
          error instanceof Error
            ? error.message
            : "No pudimos verificar el pago.",
        );
      }
    }

    consultarPago();

    return () => {
      activo = false;
    };
  }, [hash]);

  const icono =
    estado === "cargando" ? (
      <Loader2 className="spin" size={45} />
    ) : estado === "pagado" ? (
      <CheckCircle2 size={52} />
    ) : estado === "pendiente" ? (
      <Clock3 size={52} />
    ) : (
      <XCircle size={52} />
    );

  const titulo =
    estado === "cargando"
      ? "Verificando el pago"
      : estado === "pagado"
        ? "Suscripción activada"
        : estado === "pendiente"
          ? "Pago pendiente"
          : estado === "cancelado"
            ? "Pedido cancelado"
            : "No pudimos verificar el pago";

  const monto =
    detalle?.solicitud?.monto !== undefined
      ? new Intl.NumberFormat("es-PY", {
          maximumFractionDigits: 0,
        }).format(detalle.solicitud.monto)
      : null;

  return (
    <main className="result-page">
      <div className="result-grid" />

      <section className={`result-card ${estado}`}>
        <div className="result-icon">{icono}</div>

        <span className="brand-label">
          TRANSTECH EOS
        </span>

        <h1>{titulo}</h1>

        <p className="message">{mensaje}</p>

        {detalle?.solicitud && (
          <div className="payment-detail">
            <div>
              <span>Plan</span>
              <strong>
                EOS{" "}
                {capitalizar(
                  detalle.solicitud.plan_codigo ||
                    "",
                )}
              </strong>
            </div>

            <div>
              <span>Facturación</span>
              <strong>
                {capitalizar(
                  detalle.solicitud.periodicidad ||
                    "",
                )}
              </strong>
            </div>

            {monto && (
              <div>
                <span>Monto</span>
                <strong>Gs. {monto}</strong>
              </div>
            )}

            <div>
              <span>Estado</span>
              <strong>
                {capitalizar(
                  detalle.solicitud.estado ||
                    "pendiente",
                )}
              </strong>
            </div>
          </div>
        )}

        <div className="security">
          <ShieldCheck size={18} />

          <span>
            El resultado se consulta directamente en
            PagoPar y en tu registro de TransTech EOS.
          </span>
        </div>

        <div className="actions">
          <button
            type="button"
            onClick={() => router.push("/eos/chat")}
          >
            Ir a EOS
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => router.push("/planes")}
          >
            Ver planes
          </button>
        </div>
      </section>

      <style jsx>{`
        .result-page {
          position: relative;
          min-height: 100vh;
          display: grid;
          place-items: center;
          overflow: hidden;
          padding: 22px;
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

        .result-grid {
          position: fixed;
          inset: 0;
          opacity: 0.35;
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
        }

        .result-card {
          position: relative;
          z-index: 1;
          width: min(590px, 100%);
          padding: 42px;
          border: 1px solid #dbe5f2;
          border-radius: 31px;
          background: rgba(255, 255, 255, 0.97);
          text-align: center;
          box-shadow:
            0 30px 90px rgba(15, 23, 42, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.96);
        }

        .result-icon {
          display: grid;
          place-items: center;
          color: #2563eb;
        }

        .pagado .result-icon {
          color: #16a34a;
        }

        .cancelado .result-icon,
        .error .result-icon {
          color: #dc2626;
        }

        .brand-label {
          display: block;
          margin-top: 21px;
          color: #2563eb;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.17em;
        }

        h1 {
          margin: 12px 0 0;
          font-size: clamp(34px, 7vw, 48px);
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .message {
          max-width: 470px;
          margin: 16px auto 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.7;
        }

        .payment-detail {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 27px;
          padding: 15px;
          border: 1px solid #dbe5f2;
          border-radius: 18px;
          background: #f8fafc;
          text-align: left;
        }

        .payment-detail div {
          display: grid;
          gap: 4px;
          padding: 10px;
        }

        .payment-detail span {
          color: #94a3b8;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .payment-detail strong {
          color: #071226;
          font-size: 11px;
        }

        .security {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 22px;
          color: #64748b;
          font-size: 9px;
          line-height: 1.5;
        }

        .actions {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-top: 27px;
        }

        button {
          min-height: 46px;
          padding: 0 19px;
          border: 0;
          border-radius: 14px;
          background: #2563eb;
          color: white;
          font-family: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 13px 28px
            rgba(37, 99, 235, 0.2);
        }

        button.secondary {
          border: 1px solid #dbe5f2;
          background: white;
          color: #334155;
          box-shadow: none;
        }

        .spin {
          animation: spin 800ms linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 540px) {
          .result-card {
            padding: 31px 20px;
          }

          .payment-detail {
            grid-template-columns: 1fr;
          }

          .actions {
            display: grid;
          }
        }
      `}</style>
    </main>
  );
}

function capitalizar(valor: string) {
  if (!valor) return "—";

  return (
    valor.charAt(0).toUpperCase() +
    valor.slice(1)
  );
}