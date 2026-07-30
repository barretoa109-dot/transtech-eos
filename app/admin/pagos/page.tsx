"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type PagoPendiente = {
  id: string;
  usuario_id: string;
  plan_codigo: string;
  periodicidad: string;
  monto: number;
  moneda: string;
  estado: string;
  referencia_interna: string;
  created_at: string;
  metadata?: {
    comprador?: {
      nombre?: string;
      email?: string;
      telefono?: string;
      documento?: string;
      ruc?: string;
      razon_social?: string;
    };
    comprobante?: {
      ruta?: string;
      nombre_original?: string;
      tipo?: string;
      subido_at?: string;
    };
  };
  comprobante_url?: string | null;
};

type RespuestaListado = {
  ok?: boolean;
  pagos?: PagoPendiente[];
  error?: string;
};

export default function AdminPagosPage() {
  const [pagos, setPagos] = useState<PagoPendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [procesandoId, setProcesandoId] = useState("");
  const [error, setError] = useState("");

  const cargarPagos = useCallback(async () => {
    setCargando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/admin/pagos/listar", {
        cache: "no-store",
      });

      const resultado = (await respuesta
        .json()
        .catch(() => null)) as RespuestaListado | null;

      if (!respuesta.ok) {
        throw new Error(
          resultado?.error || "No se pudieron cargar los pagos pendientes.",
        );
      }

      setPagos(resultado?.pagos || []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar los pagos pendientes.",
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarPagos();
  }, [cargarPagos]);

  async function ejecutarAccion(
    solicitudId: string,
    accion: "aprobar" | "rechazar",
  ) {
    const mensaje =
      accion === "aprobar"
        ? "¿Confirmás que el dinero ingresó y querés activar este plan?"
        : "¿Confirmás que querés rechazar este comprobante?";

    if (!window.confirm(mensaje)) return;

    setProcesandoId(solicitudId);
    setError("");

    try {
      const respuesta = await fetch("/api/admin/pagos/accion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          solicitud_id: solicitudId,
          accion,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(
          resultado?.error || "No se pudo procesar la solicitud.",
        );
      }

      await cargarPagos();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo procesar la solicitud.",
      );
    } finally {
      setProcesandoId("");
    }
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <span className="admin-eyebrow">TRANSTECH EOS</span>
            <h1>Pagos pendientes</h1>
            <p>
              Revisá cada comprobante antes de aprobar y activar el plan.
            </p>
          </div>

          <button
            type="button"
            className="refresh-button"
            onClick={cargarPagos}
            disabled={cargando}
          >
            {cargando ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <RefreshCw size={17} />
            )}
            Actualizar
          </button>
        </header>

        {error && <div className="error-box">{error}</div>}

        {cargando ? (
          <section className="state-card">
            <Loader2 className="spin" size={28} />
            <strong>Cargando solicitudes...</strong>
          </section>
        ) : pagos.length === 0 ? (
          <section className="state-card">
            <CheckCircle2 size={34} />
            <strong>No hay pagos pendientes</strong>
            <p>Las nuevas transferencias aparecerán aquí.</p>
          </section>
        ) : (
          <section className="payments-grid">
            {pagos.map((pago) => {
              const comprador = pago.metadata?.comprador;
              const comprobante = pago.metadata?.comprobante;
              const procesando = procesandoId === pago.id;

              return (
                <article className="payment-card" key={pago.id}>
                  <div className="payment-card-top">
                    <div>
                      <span className="status-badge">
                        <Clock3 size={13} />
                        En revisión
                      </span>

                      <h2>{comprador?.nombre || "Cliente"}</h2>

                      <a href={`mailto:${comprador?.email || ""}`}>
                        {comprador?.email || "Sin correo"}
                      </a>
                    </div>

                    <div className="amount">
                      <strong>
                        Gs.{" "}
                        {new Intl.NumberFormat("es-PY", {
                          maximumFractionDigits: 0,
                        }).format(Number(pago.monto))}
                      </strong>
                      <span>{pago.periodicidad}</span>
                    </div>
                  </div>

                  <div className="details">
                    <Detail label="Plan" value={`EOS ${pago.plan_codigo}`} />
                    <Detail
                      label="Referencia"
                      value={pago.referencia_interna}
                    />
                    <Detail
                      label="Teléfono"
                      value={comprador?.telefono || "—"}
                    />
                    <Detail
                      label="Documento"
                      value={comprador?.documento || "—"}
                    />
                    <Detail
                      label="Fecha"
                      value={new Intl.DateTimeFormat("es-PY", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(pago.created_at))}
                    />
                    <Detail
                      label="Archivo"
                      value={comprobante?.nombre_original || "—"}
                    />
                  </div>

                  <div className="proof-box">
                    <ShieldCheck size={20} />

                    <div>
                      <strong>Comprobante privado</strong>
                      <span>
                        El enlace es temporal y solamente se genera para el
                        administrador.
                      </span>
                    </div>

                    {pago.comprobante_url ? (
                      <a
                        href={pago.comprobante_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver comprobante
                        <ExternalLink size={15} />
                      </a>
                    ) : (
                      <span className="missing-proof">
                        Sin comprobante disponible
                      </span>
                    )}
                  </div>

                  <div className="actions">
                    <button
                      type="button"
                      className="reject"
                      disabled={procesando}
                      onClick={() => ejecutarAccion(pago.id, "rechazar")}
                    >
                      <XCircle size={17} />
                      Rechazar
                    </button>

                    <button
                      type="button"
                      className="approve"
                      disabled={procesando}
                      onClick={() => ejecutarAccion(pago.id, "aprobar")}
                    >
                      {procesando ? (
                        <Loader2 className="spin" size={17} />
                      ) : (
                        <CheckCircle2 size={17} />
                      )}
                      Aprobar y activar
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      <style jsx>{`
        .admin-page {
          min-height: 100vh;
          padding: 34px 24px 70px;
          background:
            radial-gradient(
              circle at 88% 8%,
              rgba(37, 99, 235, 0.12),
              transparent 28%
            ),
            linear-gradient(
              180deg,
              #ffffff 0%,
              #f5f9ff 52%,
              #edf4ff 100%
            );
          color: #071226;
          font-family: Inter, Arial, Helvetica, sans-serif;
        }

        .admin-shell {
          width: min(1180px, 100%);
          margin: 0 auto;
        }

        .admin-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 22px;
          padding-bottom: 25px;
          border-bottom: 1px solid #dbe5f2;
        }

        .admin-eyebrow {
          color: #2563eb;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.17em;
        }

        h1 {
          margin: 8px 0 0;
          font-size: clamp(34px, 6vw, 52px);
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .admin-header p {
          margin: 10px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .refresh-button {
          min-height: 45px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 0 17px;
          border: 1px solid #dbe5f2;
          border-radius: 14px;
          background: white;
          color: #334155;
          font-family: inherit;
          font-size: 11px;
          font-weight: 850;
          cursor: pointer;
        }

        .payments-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 19px;
          margin-top: 28px;
        }

        .payment-card,
        .state-card {
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 25px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 22px 65px rgba(15, 23, 42, 0.08);
        }

        .payment-card {
          padding: 24px;
        }

        .payment-card-top {
          display: flex;
          justify-content: space-between;
          gap: 18px;
        }

        .status-badge {
          width: fit-content;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 9px;
          border-radius: 999px;
          background: #fff7ed;
          color: #c2410c;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        h2 {
          margin: 13px 0 0;
          font-size: 22px;
          letter-spacing: -0.03em;
        }

        .payment-card-top a {
          display: inline-block;
          margin-top: 5px;
          color: #2563eb;
          font-size: 10px;
          font-weight: 750;
          text-decoration: none;
          overflow-wrap: anywhere;
        }

        .amount {
          flex-shrink: 0;
          display: grid;
          align-content: start;
          justify-items: end;
          gap: 4px;
          text-align: right;
        }

        .amount strong {
          color: #2563eb;
          font-size: 21px;
        }

        .amount span {
          color: #64748b;
          font-size: 9px;
          text-transform: capitalize;
        }

        .details {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
          margin-top: 20px;
          padding: 14px;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #f8fafc;
        }

        .proof-box {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 11px;
          margin-top: 15px;
          padding: 15px;
          border: 1px solid #bfdbfe;
          border-radius: 16px;
          background: #eff6ff;
          color: #2563eb;
        }

        .proof-box div {
          display: grid;
          gap: 4px;
        }

        .proof-box strong {
          color: #071226;
          font-size: 10px;
        }

        .proof-box span {
          color: #64748b;
          font-size: 8px;
          line-height: 1.45;
        }

        .proof-box a {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 38px;
          padding: 0 11px;
          border-radius: 11px;
          background: #2563eb;
          color: white;
          font-size: 9px;
          font-weight: 900;
          text-decoration: none;
        }

        .missing-proof {
          color: #b91c1c !important;
          font-weight: 850;
        }

        .actions {
          display: grid;
          grid-template-columns: 0.8fr 1.2fr;
          gap: 10px;
          margin-top: 16px;
        }

        .actions button {
          min-height: 46px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 0;
          border-radius: 13px;
          font-family: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }

        .actions button:disabled {
          opacity: 0.6;
          cursor: wait;
        }

        .reject {
          border: 1px solid #fecaca !important;
          background: #fef2f2;
          color: #dc2626;
        }

        .approve {
          background: #2563eb;
          color: white;
          box-shadow: 0 13px 28px rgba(37, 99, 235, 0.2);
        }

        .state-card {
          min-height: 280px;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 11px;
          margin-top: 28px;
          padding: 30px;
          color: #2563eb;
          text-align: center;
        }

        .state-card strong {
          color: #071226;
          font-size: 20px;
        }

        .state-card p {
          margin: 0;
          color: #64748b;
          font-size: 11px;
        }

        .error-box {
          margin-top: 20px;
          padding: 13px 15px;
          border: 1px solid #fecaca;
          border-radius: 14px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 11px;
          font-weight: 750;
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
          .payments-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 620px) {
          .admin-page {
            padding: 24px 14px 50px;
          }

          .admin-header {
            align-items: stretch;
            flex-direction: column;
          }

          .refresh-button {
            width: 100%;
          }

          .payment-card-top {
            display: grid;
          }

          .amount {
            justify-items: start;
            text-align: left;
          }

          .details {
            grid-template-columns: 1fr;
          }

          .proof-box {
            grid-template-columns: auto 1fr;
          }

          .proof-box a,
          .missing-proof {
            grid-column: 1 / -1;
          }

          .actions {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: "4px",
        minWidth: 0,
        padding: "8px",
      }}
    >
      <span
        style={{
          color: "#94a3b8",
          fontSize: "8px",
          fontWeight: 900,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>

      <strong
        style={{
          color: "#071226",
          fontSize: "10px",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </strong>
    </div>
  );
}
