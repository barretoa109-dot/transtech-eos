"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Target } from "lucide-react";
import type { Briefing } from "../types/briefing";
import BriefingCorreoToggle from "./BriefingCorreoToggle";

type DecisionSummary = {
  id: string;
  titulo: string;
  estado: string;
  result_count: number;
};

type BriefingViewProps = {
  briefing: Briefing;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  isStale?: boolean;
  historyCount?: number;
  onRefresh?: () => void;
  onGoToDecisions?: () => void;
};

export default function BriefingView({
  briefing,
  loading = false,
  refreshing = false,
  error,
  isStale = false,
  historyCount = 0,
  onRefresh,
  onGoToDecisions,
}: BriefingViewProps) {
  const briefingDate = formatBriefingDate(briefing.briefing_date);

  const [decisiones, setDecisiones] = useState<DecisionSummary[] | null>(null);

  useEffect(() => {
    let activo = true;

    fetch("/api/decisions", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (activo) setDecisiones(payload.decisions ?? []);
      })
      .catch(() => {
        if (activo) setDecisiones([]);
      });

    return () => {
      activo = false;
    };
  }, []);

  const pendientes = (decisiones ?? []).filter(
    (d) => d.result_count === 0 && d.estado !== "cerrada" && d.estado !== "cancelada",
  );

  return (
    <div className="view" id="view-briefing">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Briefing</div>
          <div className="page-title">{briefing.saludo || "Resumen ejecutivo"}</div>
          <div className="page-sub">
            {briefingDate || (loading ? "Preparando tu briefing..." : "Sin briefing de hoy")}
            {isStale ? " · desactualizado" : ""}
            {historyCount > 1 ? ` · ${historyCount} briefings recientes` : ""}
          </div>
        </div>

        {onRefresh && (
          <div className="chip-row">
            <button
              type="button"
              className="chip"
              onClick={onRefresh}
              disabled={refreshing}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: refreshing ? "wait" : "pointer" }}
            >
              <RefreshCw size={12} className={refreshing ? "spin" : ""} />
              {refreshing ? "Actualizando..." : "Actualizar briefing"}
            </button>
          </div>
        )}

        {error && (
          <div className="card" style={{ borderColor: "var(--amber)", color: "var(--amber)", marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div className="card">
          <div className="card-title">Resumen del día</div>
          <div className="prose">{briefing.resumen}</div>
          {briefing.enfoque_dia && (
            <div className="prose" style={{ marginTop: 10, fontWeight: 600 }}>
              <Target size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              Foco del día: {briefing.enfoque_dia}
            </div>
          )}
        </div>

        <BriefingCorreoToggle />

        <div className="card">
          <div className="card-title">Decisiones pendientes</div>
          {decisiones === null ? (
            <p className="empty-note">Cargando decisiones…</p>
          ) : pendientes.length === 0 ? (
            <p className="prose">No tenés decisiones pendientes de resultado en este momento.</p>
          ) : (
            <p className="prose">
              {pendientes.length === 1
                ? "1 decisión espera su resultado: "
                : `${pendientes.length} decisiones esperan su resultado: `}
              {pendientes
                .slice(0, 3)
                .map((d) => `"${d.titulo}"`)
                .join(", ")}
              {pendientes.length > 3 ? ` y ${pendientes.length - 3} más` : ""}.{" "}
              {onGoToDecisions ? (
                <button
                  type="button"
                  onClick={onGoToDecisions}
                  style={{ color: "var(--blue)", fontWeight: 700, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  Revisalas en la sección Decisiones.
                </button>
              ) : (
                "Revisalas en la sección Decisiones."
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBriefingDate(value?: string | null) {
  if (!value) return "";

  const date = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-PY", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Asuncion",
  }).format(date);
}
