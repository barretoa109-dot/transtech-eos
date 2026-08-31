"use client";

import Link from "next/link";
import { Check, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Approval = {
  id: string;
  request_id: string;
  accion: string;
  status: "pending" | "approved";
  reason: string | null;
  risk_tier: number;
  risk_points: number;
  effective_level: number;
  payload_snapshot: {
    mensaje?: string;
    datos?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  expires_at: string;
  decided_at: string | null;
  created_at: string;
};

function actionLabel(action: string) {
  if (action === "CREAR_OBJETIVO") return "Crear objetivo";
  if (action === "CREAR_TAREA") return "Crear tarea";
  if (action === "GUARDAR_MEMORIA") return "Guardar memoria";
  if (action === "REGISTRAR_VENTA") return "Registrar venta";
  if (action === "AJUSTAR_STOCK") return "Actualizar stock";
  if (action === "CREAR_CONTACTO") return "Crear contacto";
  return action.replaceAll("_", " ");
}

function actionDetail(approval: Approval) {
  const datos = approval.payload_snapshot?.datos || {};
  const title =
    String(datos.titulo || datos.nombre || datos.name || "").trim();

  return title || approval.payload_snapshot?.mensaje || "Acción solicitada por EOS";
}

export default function AutonomyApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Ningún `setState` antes del primer `await`: al montar el estado ya
  // arranca así, y hacerlo costaba un render extra en cascada.
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/autonomy/approvals", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudieron cargar las aprobaciones.");
      }

      setApprovals(Array.isArray(payload?.approvals) ? payload.approvals : []);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las aprobaciones.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /** Actualizar a mano sí vuelve a mostrar el spinner. */
  const recargar = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function decide(id: string, status: "approved" | "rejected") {
    setBusy(id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/autonomy/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo registrar la decisión.");
      }

      setNotice(
        status === "approved"
          ? payload?.executed === true
            ? "Aprobación registrada y acción ejecutada correctamente."
            : "Aprobación registrada."
          : "La solicitud fue rechazada.",
      );

      await load();
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "No se pudo registrar la decisión.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page">
      <section className="shell">
        <header className="header">
          <div>
            <span className="eyebrow">GOBIERNO DE EJECUCIÓN</span>
            <h1>Aprobaciones de EOS</h1>
            <p>
              Revisá las acciones que EOS no puede ejecutar sin tu autorización
              explícita.
            </p>
          </div>

          <div className="headerActions">
            <button type="button" onClick={recargar} disabled={loading}>
              <RefreshCw size={15} /> Actualizar
            </button>
            <Link href="/eos/chat">Volver al chat</Link>
          </div>
        </header>

        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner success">{notice}</div>}

        {loading ? (
          <div className="state">
            <LoaderCircle className="spin" size={24} />
            <span>Cargando aprobaciones…</span>
          </div>
        ) : approvals.length === 0 ? (
          <div className="state empty">
            <ShieldCheck size={30} />
            <strong>No tenés aprobaciones pendientes.</strong>
            <span>EOS seguirá aplicando las reglas de autonomía configuradas.</span>
          </div>
        ) : (
          <div className="list">
            {approvals.map((approval) => (
              <article className="card" key={approval.id}>
                <div className="copy">
                  <div className="titleRow">
                    <strong>{actionLabel(approval.accion)}</strong>
                    <span className={`status ${approval.status}`}>
                      {approval.status === "approved" ? "Aprobada" : "Pendiente"}
                    </span>
                  </div>
                  <p className="detail">{actionDetail(approval)}</p>
                  <p className="reason">
                    {approval.reason || "Esta acción requiere aprobación explícita."}
                  </p>
                  <small>
                    Riesgo {approval.risk_tier} · {approval.risk_points} pts · vence {" "}
                    {new Date(approval.expires_at).toLocaleString("es-PY")}
                  </small>
                </div>

                <div className="actions">
                  {approval.status === "pending" && (
                    <button
                      type="button"
                      className="reject"
                      disabled={busy === approval.id}
                      onClick={() => void decide(approval.id, "rejected")}
                    >
                      <X size={15} /> Rechazar
                    </button>
                  )}
                  <button
                    type="button"
                    className="approve"
                    disabled={busy === approval.id}
                    onClick={() => void decide(approval.id, "approved")}
                  >
                    {busy === approval.id ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Check size={15} />
                    )}
                    {approval.status === "approved" ? "Continuar ejecución" : "Aprobar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <style jsx>{`
        .page {
          min-height: 100vh;
          padding: 44px 24px 80px;
          background:
            radial-gradient(circle at 85% 5%, rgba(59,130,246,.12), transparent 28%),
            linear-gradient(180deg, #07101d 0%, #091524 55%, #07111f 100%);
          color: #e5eefb;
          font-family: Inter, Arial, sans-serif;
        }
        .shell { width: min(100%, 980px); margin: 0 auto; }
        .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
        .eyebrow { color: #60a5fa; font-size: 10px; font-weight: 900; letter-spacing: .15em; }
        h1 { margin: 7px 0 8px; font-size: 30px; color: #fff; }
        .header p { margin: 0; color: #94a3b8; line-height: 1.55; max-width: 650px; }
        .headerActions { display: flex; gap: 10px; flex-wrap: wrap; }
        .headerActions button, .headerActions :global(a) {
          min-height: 40px; display: inline-flex; align-items: center; gap: 8px;
          padding: 0 14px; border: 1px solid rgba(96,165,250,.3); border-radius: 12px;
          background: rgba(37,99,235,.12); color: #bfdbfe; text-decoration: none;
          font: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
        }
        .banner { margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; font-size: 13px; }
        .error { border: 1px solid rgba(248,113,113,.3); background: rgba(127,29,29,.25); color: #fecaca; }
        .success { border: 1px solid rgba(74,222,128,.28); background: rgba(20,83,45,.28); color: #bbf7d0; }
        .state { min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 11px; color: #94a3b8; }
        .state strong { color: #f8fafc; font-size: 18px; }
        .list { display: grid; gap: 12px; }
        .card { display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 18px;
          border: 1px solid rgba(148,163,184,.16); border-radius: 17px; background: rgba(15,23,42,.66);
          box-shadow: 0 18px 48px rgba(0,0,0,.14); backdrop-filter: blur(16px); }
        .copy { min-width: 0; flex: 1; }
        .titleRow { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
        .titleRow strong { color: #fff; font-size: 15px; }
        .status { padding: 4px 8px; border-radius: 999px; font-size: 9px; font-weight: 900; }
        .status.pending { background: rgba(245,158,11,.14); color: #fcd34d; }
        .status.approved { background: rgba(34,197,94,.14); color: #86efac; }
        .detail { margin: 8px 0 4px; color: #dbeafe; font-size: 13px; }
        .reason { margin: 0; color: #94a3b8; font-size: 11px; line-height: 1.5; }
        small { display: block; margin-top: 8px; color: #64748b; font-size: 10px; }
        .actions { display: flex; gap: 8px; flex-shrink: 0; }
        .actions button { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          padding: 0 13px; border-radius: 11px; font: inherit; font-size: 11px; font-weight: 850; cursor: pointer; }
        .reject { border: 1px solid rgba(248,113,113,.3); background: rgba(127,29,29,.25); color: #fecaca; }
        .approve { border: 1px solid rgba(74,222,128,.3); background: rgba(20,83,45,.32); color: #bbf7d0; }
        .spin { animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 720px) {
          .page { padding: 28px 14px 60px; }
          .header, .card { flex-direction: column; align-items: stretch; }
          .actions { width: 100%; }
          .actions button { flex: 1; }
        }
      `}</style>
    </main>
  );
}
