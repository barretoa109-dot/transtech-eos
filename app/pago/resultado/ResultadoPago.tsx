"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock3, Loader2, ShieldCheck, XCircle } from "lucide-react";

type Estado = "cargando" | "revision" | "pagado" | "rechazado" | "error";

type Solicitud = {
  plan_codigo?: string;
  periodicidad?: string;
  monto?: number;
  estado?: string;
  referencia_interna?: string;
};

export default function ResultadoPago() {
  const router = useRouter();
  const params = useSearchParams();
  const solicitudId = params.get("solicitud") || "";

  const [estado, setEstado] = useState<Estado>("cargando");
  const [mensaje, setMensaje] = useState("Estamos consultando tu solicitud.");
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null);

  useEffect(() => {
    let activo = true;

    async function consultar() {
      if (!solicitudId) {
        setEstado("error");
        setMensaje("No recibimos el identificador de la solicitud.");
        return;
      }

      try {
        const respuesta = await fetch("/api/pagos/consultar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ solicitud_id: solicitudId }),
        });

        const resultado = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
          throw new Error(resultado?.error || "No pudimos consultar el pedido.");
        }

        if (!activo) return;

        setSolicitud(resultado.solicitud);

        const valor = resultado.solicitud?.estado;

        if (valor === "pagado") {
          setEstado("pagado");
          setMensaje("El pago fue aprobado y tu plan de TransTech EOS ya está activo.");
        } else if (valor === "rechazado" || valor === "cancelado") {
          setEstado("rechazado");
          setMensaje("El comprobante no pudo ser aprobado. Contactá con TransTech.");
        } else {
          setEstado("revision");
          setMensaje(
            "Recibimos tu comprobante. Verificaremos el ingreso y activaremos tu plan.",
          );
        }
      } catch (error) {
        if (!activo) return;
        setEstado("error");
        setMensaje(
          error instanceof Error ? error.message : "No pudimos consultar el pedido.",
        );
      }
    }

    consultar();
    return () => { activo = false; };
  }, [solicitudId]);

  const monto =
    solicitud?.monto !== undefined
      ? new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(
          solicitud.monto,
        )
      : null;

  const icono =
    estado === "cargando" ? (
      <Loader2 className="spin" size={48} />
    ) : estado === "pagado" ? (
      <CheckCircle2 size={54} />
    ) : estado === "revision" ? (
      <Clock3 size={54} />
    ) : (
      <XCircle size={54} />
    );

  const titulo =
    estado === "cargando"
      ? "Consultando solicitud"
      : estado === "pagado"
        ? "Suscripción activada"
        : estado === "revision"
          ? "Comprobante recibido"
          : "No pudimos confirmar la solicitud";

  return (
    <main className="page">
      <section className={`card ${estado}`}>
        <div className="icon">{icono}</div>
        <span className="brand">TRANSTECH EOS</span>
        <h1>{titulo}</h1>
        <p>{mensaje}</p>

        {solicitud && (
          <div className="detail">
            <div><span>Plan</span><strong>EOS {solicitud.plan_codigo}</strong></div>
            <div><span>Facturación</span><strong>{solicitud.periodicidad}</strong></div>
            {monto && <div><span>Monto</span><strong>Gs. {monto}</strong></div>}
            <div><span>Referencia</span><strong>{solicitud.referencia_interna}</strong></div>
          </div>
        )}

        <div className="security">
          <ShieldCheck size={18} />
          <span>La activación se realiza solamente después de verificar el ingreso bancario.</span>
        </div>

        <div className="actions">
          <button onClick={() => router.push("/eos/chat")}>Ir a EOS</button>
          <button className="secondary" onClick={() => router.push("/planes")}>Ver planes</button>
        </div>
      </section>

      <style jsx>{`
        .page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 22px;
          background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 52%, #edf4ff 100%);
          color: #071226;
          font-family: Inter, Arial, sans-serif;
        }
        .card {
          width: min(590px, 100%);
          padding: 42px;
          border: 1px solid #dbe5f2;
          border-radius: 31px;
          background: white;
          text-align: center;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.12);
        }
        .icon { color: #2563eb; }
        .pagado .icon { color: #16a34a; }
        .rechazado .icon, .error .icon { color: #dc2626; }
        .brand {
          display: block;
          margin-top: 20px;
          color: #2563eb;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.17em;
        }
        h1 {
          margin: 12px 0 0;
          font-size: clamp(34px, 7vw, 48px);
          letter-spacing: -0.05em;
        }
        p { color: #64748b; font-size: 13px; line-height: 1.7; }
        .detail {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 26px;
          padding: 15px;
          border: 1px solid #dbe5f2;
          border-radius: 18px;
          background: #f8fafc;
          text-align: left;
        }
        .detail div { display: grid; gap: 4px; padding: 10px; }
        .detail span { color: #94a3b8; font-size: 8px; font-weight: 900; text-transform: uppercase; }
        .detail strong { font-size: 11px; overflow-wrap: anywhere; }
        .security {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-top: 22px;
          color: #64748b;
          font-size: 9px;
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
          font-weight: 900;
          cursor: pointer;
        }
        button.secondary {
          border: 1px solid #dbe5f2;
          background: white;
          color: #334155;
        }
        .spin { animation: spin 800ms linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 540px) {
          .card { padding: 31px 20px; }
          .detail { grid-template-columns: 1fr; }
          .actions { display: grid; }
        }
      `}</style>
    </main>
  );
}
