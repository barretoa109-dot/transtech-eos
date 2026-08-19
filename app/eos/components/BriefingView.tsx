"use client";

import { AlertTriangle, Award, MessageCircleMore, RefreshCw, Target } from "lucide-react";
import type { Briefing, BriefingItem } from "../types/briefing";

type BriefingViewProps = {
  briefing: Briefing;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  isStale?: boolean;
  historyCount?: number;
  onRefresh?: () => void;
  onOpenChat?: (prompt: string) => void;
};

export default function BriefingView({
  briefing,
  loading = false,
  refreshing = false,
  error,
  isStale = false,
  historyCount = 0,
  onRefresh,
  onOpenChat,
}: BriefingViewProps) {
  const briefingDate = formatBriefingDate(briefing.briefing_date);
  const logros = normalizeItems(briefing.logros);
  const riesgos = normalizeItems(briefing.riesgos);
  const pasos = normalizeItems(briefing.proximos_pasos).slice(0, 4);
  const prioridades = [briefing.prioridad_1, briefing.prioridad_2, briefing.prioridad_3].filter(
    (p): p is string => Boolean(p && p.trim()),
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
            <button type="button" className="chip" onClick={onRefresh} disabled={refreshing} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: refreshing ? "wait" : "pointer" }}>
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

        {prioridades.length > 0 && (
          <div className="card">
            <div className="card-title">Prioridades detectadas</div>
            <div className="card-sub">{prioridades.length} para hoy</div>
            <div className="priority-list">
              {prioridades.map((texto, i) => (
                <div className="priority-item" key={i}>
                  <div className="p-check" style={{ cursor: "default" }} />
                  <div className="p-text">{texto}</div>
                  <div className={`p-tag ${i === 0 ? "alta" : i === 1 ? "media" : "baja"}`}>
                    {i === 0 ? "Alta" : i === 1 ? "Media" : "Normal"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(logros.length > 0 || riesgos.length > 0) && (
          <div className="card">
            <div className="card-title">Avances y riesgos</div>
            {logros.map((item, i) => (
              <div className="reco" key={`logro-${i}`}>
                <div className="ric" style={{ background: "var(--green-light)", color: "var(--green)" }}>
                  <Award size={16} />
                </div>
                <div>
                  <div className="rt">{item.titulo}</div>
                  {item.descripcion && <div className="rs">{item.descripcion}</div>}
                </div>
              </div>
            ))}
            {riesgos.map((item, i) => (
              <div className="reco" key={`riesgo-${i}`}>
                <div className="ric" style={{ background: "var(--amber-light)", color: "var(--amber)" }}>
                  <AlertTriangle size={16} />
                </div>
                <div>
                  <div className="rt">{item.titulo}</div>
                  {item.descripcion && <div className="rs">{item.descripcion}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="card-title">Recomendación principal</div>
          <div className="prose">{briefing.recomendacion_principal}</div>
          {onOpenChat && (
            <button
              type="button"
              className="reco-btn"
              style={{ marginTop: 12 }}
              onClick={() =>
                onOpenChat(
                  `Quiero trabajar sobre esta recomendación de mi briefing: ${briefing.recomendacion_principal || "ayudame a definir la mejor acción para hoy"}`,
                )
              }
            >
              <MessageCircleMore size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
              Trabajar esto con EOS
            </button>
          )}
        </div>

        {pasos.length > 0 && (
          <div className="card">
            <div className="card-title">Próximos pasos</div>
            <div className="priority-list">
              {pasos.map((paso, i) => (
                <div className="priority-item" key={i}>
                  <div className="p-check" style={{ cursor: "default" }} />
                  <div className="p-text">
                    <strong>{paso.titulo}</strong>
                    {paso.descripcion && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{paso.descripcion}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeItems(value?: BriefingItem[]) {
  return Array.isArray(value) ? value.filter((item) => item?.titulo?.trim()) : [];
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
