"use client";

import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Goal = {
  id?: string;
  title?: string;
  progress?: number;
  priority?: number;
  gap_percent?: number;
  deadline?: string | null;
  overdue?: boolean;
  next_step?: string;
};

type Gap = {
  type?: string;
  goal_id?: string | null;
  title?: string;
  priority?: number;
  progress?: number;
  gap_percent?: number;
  deadline?: string | null;
  next_step?: string;
};

type Priority = {
  rank?: number;
  source?: string;
  title?: string;
  reason?: string;
  next_step?: string;
};

type Capability = {
  category?: string;
  pattern?: string;
  recommendation?: string;
  confidence?: number;
  evidence_count?: number;
  state?: string;
};

type Risk = {
  source?: string;
  type?: string;
  severity?: string;
  title?: string;
  message?: string;
  pattern?: string;
  recommendation?: string;
  action?: string;
  error_message?: string;
};

type Opportunity = {
  source?: string;
  title?: string;
  progress?: number;
  priority?: number;
  next_step?: string;
  rationale?: string;
};

type Twin = {
  usuario_id: string;
  version: number;
  model_version: string;
  identity: Record<string, unknown>;
  current_state: Record<string, unknown>;
  desired_state: { goals?: Goal[]; master_goals?: unknown[] };
  gaps: Gap[];
  constraints: unknown[];
  capabilities: Capability[];
  risks: Risk[];
  opportunities: Opportunity[];
  priorities: Priority[];
  execution_profile: Record<string, unknown>;
  learning_profile: Record<string, unknown>;
  autonomy_profile: Record<string, unknown>;
  intelligence_score: number | null;
  confidence: number;
  source_completeness: number;
  generated_at: string;
  valid_until: string;
  is_stale: boolean;
  age_minutes: number;
};

type TwinHistory = {
  id: string;
  version: number;
  confidence: number;
  source_completeness: number;
  generated_at: string;
  created_at: string;
};

type TwinPayload = {
  twin: Twin | null;
  history: TwinHistory[];
  needs_refresh: boolean;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function percent(value: unknown) {
  return `${Math.round(numberValue(value) * 100)}%`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function identityEntries(identity: Record<string, unknown>) {
  return Object.entries(identity)
    .filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    )
    .slice(0, 8);
}

export default function BusinessTwinView() {
  const [data, setData] = useState<TwinPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/twin", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo cargar el Business Twin.");
      }

      setData(payload);

      if (!payload?.twin || payload?.needs_refresh) {
        const refreshResponse = await fetch("/api/twin/refresh", {
          method: "POST",
        });
        const refreshPayload = await refreshResponse.json().catch(() => null);
        if (!refreshResponse.ok) {
          throw new Error(
            refreshPayload?.error || "No se pudo crear el Business Twin.",
          );
        }

        const reload = await fetch("/api/twin", { cache: "no-store" });
        const reloadPayload = await reload.json().catch(() => null);
        if (!reload.ok) {
          throw new Error(reloadPayload?.error || "No se pudo recargar el Twin.");
        }
        setData(reloadPayload);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el Business Twin.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");

    try {
      const response = await fetch("/api/twin/refresh", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo actualizar el Business Twin.");
      }

      const reload = await fetch("/api/twin", { cache: "no-store" });
      const reloadPayload = await reload.json().catch(() => null);
      if (!reload.ok) {
        throw new Error(reloadPayload?.error || "No se pudo recargar el Twin.");
      }
      setData(reloadPayload);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "No se pudo actualizar el Business Twin.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const twin = data?.twin || null;
  const goals = twin?.desired_state?.goals || [];
  const identities = useMemo(
    () => (twin ? identityEntries(twin.identity || {}) : []),
    [twin],
  );

  if (loading) {
    return (
      <div className="twin-state">
        <LoaderCircle className="spin" size={27} />
        <strong>Construyendo tu realidad operativa…</strong>
        <span>EOS está reuniendo señales verificables.</span>
        <style jsx>{stateStyles}</style>
      </div>
    );
  }

  if (!twin) {
    return (
      <div className="twin-state">
        <BrainCircuit size={30} />
        <strong>Tu Business Twin todavía no está disponible.</strong>
        <span>{error || "Podés volver a intentarlo ahora."}</span>
        <button type="button" onClick={() => void load()}>
          Reintentar
        </button>
        <style jsx>{stateStyles}</style>
      </div>
    );
  }

  return (
    <main className="twin-page">
      <div className="twin-container">
        <header className="twin-header">
          <div>
            <span className="eyebrow">
              <BrainCircuit size={15} /> MODELO OPERATIVO VIVO
            </span>
            <h1>EOS Business Twin</h1>
            <p>
              Una representación estructurada de dónde estás, hacia dónde vas y
              qué separa ambos estados, construida únicamente con señales que EOS
              ya puede justificar.
            </p>
          </div>

          <button
            type="button"
            className="refresh"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {refreshing ? "Actualizando…" : "Actualizar Twin"}
          </button>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="metrics">
          <Metric
            icon={<Gauge size={20} />}
            value={
              twin.intelligence_score === null ? "—" : twin.intelligence_score
            }
            label="Intelligence Score"
          />
          <Metric
            icon={<ShieldCheck size={20} />}
            value={percent(twin.confidence)}
            label="Confianza del Twin"
          />
          <Metric
            icon={<CheckCircle2 size={20} />}
            value={percent(twin.source_completeness)}
            label="Cobertura de fuentes"
          />
          <Metric
            icon={<RefreshCw size={20} />}
            value={`v${twin.version}`}
            label={twin.is_stale ? "Versión desactualizada" : "Versión vigente"}
          />
        </section>

        <section className="twin-grid twin-grid-main">
          <article className="panel current-panel">
            <PanelTitle
              icon={<Gauge size={18} />}
              eyebrow="AHORA"
              title="Tu realidad operativa"
            />

            <div className="state-stats">
              <StateStat
                label="Objetivos activos"
                value={numberValue(twin.current_state.active_goals)}
              />
              <StateStat
                label="Objetivos vencidos"
                value={numberValue(twin.current_state.overdue_goals)}
              />
              <StateStat
                label="Seguimientos pendientes"
                value={numberValue(twin.current_state.pending_followups)}
              />
              <StateStat
                label="Acciones completadas · 30d"
                value={numberValue(twin.current_state.completed_actions_30d)}
              />
            </div>

            {identities.length > 0 ? (
              <div className="identity-list">
                {identities.map(([key, value]) => (
                  <div key={key}>
                    <span>{key.replaceAll("_", " ")}</span>
                    <strong>{String(value)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </article>

          <article className="panel desired-panel">
            <PanelTitle
              icon={<Target size={18} />}
              eyebrow="DESTINO"
              title="Hacia dónde vas"
            />

            {goals.length > 0 ? (
              <div className="goal-list">
                {goals.slice(0, 6).map((goal, index) => (
                  <div className="goal-row" key={goal.id || `${goal.title}-${index}`}>
                    <div className="goal-copy">
                      <strong>{goal.title || "Objetivo"}</strong>
                      <span>
                        {goal.deadline ? dateLabel(goal.deadline) : "Sin fecha límite"}
                        {goal.overdue ? " · Vencido" : ""}
                      </span>
                    </div>
                    <div className="goal-progress">
                      <strong>{Math.round(numberValue(goal.progress))}%</strong>
                      <div>
                        <span
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(100, numberValue(goal.progress)),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine text="EOS todavía no tiene objetivos estructurados para modelar el estado deseado." />
            )}
          </article>
        </section>

        <section className="panel priorities-panel">
          <PanelTitle
            icon={<ArrowRight size={18} />}
            eyebrow="BRECHA → ACCIÓN"
            title="Prioridades que acercan ambos estados"
          />

          {twin.priorities?.length > 0 ? (
            <div className="priority-list">
              {twin.priorities.map((priority, index) => (
                <article key={`${priority.rank}-${priority.title}-${index}`}>
                  <span className="priority-rank">
                    {priority.rank || index + 1}
                  </span>
                  <div>
                    <strong>{priority.title || "Prioridad"}</strong>
                    <p>{priority.reason || "Brecha operativa priorizada por EOS."}</p>
                    {priority.next_step ? (
                      <small>Próximo paso: {priority.next_step}</small>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyLine text="No hay suficientes brechas verificables para priorizar todavía." />
          )}
        </section>

        <section className="twin-grid">
          <article className="panel">
            <PanelTitle
              icon={<AlertTriangle size={18} />}
              eyebrow="RIESGO"
              title="Qué puede frenarte"
            />
            <SignalList
              items={(twin.risks || []).slice(0, 7).map((risk) => ({
                title:
                  risk.title ||
                  risk.pattern ||
                  risk.action ||
                  risk.type ||
                  "Riesgo detectado",
                detail:
                  risk.message ||
                  risk.recommendation ||
                  risk.error_message ||
                  `Fuente: ${risk.source || "EOS"}`,
              }))}
              empty="No hay riesgos estructurados suficientes en esta versión."
            />
          </article>

          <article className="panel">
            <PanelTitle
              icon={<Sparkles size={18} />}
              eyebrow="OPORTUNIDAD"
              title="Dónde hay tracción"
            />
            <SignalList
              items={(twin.opportunities || []).slice(0, 7).map((opportunity) => ({
                title: opportunity.title || "Oportunidad",
                detail:
                  opportunity.rationale ||
                  opportunity.next_step ||
                  "Señal operativa favorable.",
              }))}
              empty="EOS todavía no identifica oportunidades con evidencia suficiente."
            />
          </article>

          <article className="panel">
            <PanelTitle
              icon={<CheckCircle2 size={18} />}
              eyebrow="CAPACIDAD"
              title="Qué está demostrando funcionar"
            />
            <SignalList
              items={(twin.capabilities || []).slice(0, 7).map((capability) => ({
                title: capability.pattern || capability.category || "Capacidad",
                detail: `${capability.recommendation || "Patrón respaldado por evidencia."} · ${Math.round(
                  numberValue(capability.confidence) * 100,
                )}% confianza`,
              }))}
              empty="Todavía no hay capacidades con evidencia longitudinal suficiente."
            />
          </article>

          <article className="panel">
            <PanelTitle
              icon={<ShieldCheck size={18} />}
              eyebrow="LÍMITES"
              title="Restricciones y gobierno"
            />
            <div className="profile-stack">
              <StateStat
                label="Autonomía activa"
                value={twin.autonomy_profile.enabled ? "Sí" : "No"}
              />
              <StateStat
                label="Nivel predeterminado"
                value={numberValue(twin.autonomy_profile.default_level, 1)}
              />
              <StateStat
                label="Acciones automáticas / día"
                value={numberValue(
                  twin.autonomy_profile.max_auto_actions_per_day,
                )}
              />
              <StateStat
                label="Fallos de ejecución · 30d"
                value={numberValue(twin.execution_profile.failed)}
              />
            </div>
          </article>
        </section>

        <footer className="twin-footer">
          <span>
            Versión {twin.version} · generada {dateLabel(twin.generated_at)} · {twin.age_minutes}{" "}
            min de antigüedad
          </span>
          <span>{data?.history?.length || 0} versiones recientes disponibles</span>
        </footer>
      </div>

      <style jsx>{`
        .twin-page{min-height:100%;padding:36px 28px 74px;background:radial-gradient(circle at 78% 6%,rgba(37,99,235,.12),transparent 27%),linear-gradient(145deg,#fff 0%,#f7faff 50%,#edf5ff 100%);color:#071226;font-family:Inter,Arial,Helvetica,sans-serif}.twin-container{max-width:1200px;margin:0 auto}.twin-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.eyebrow{display:flex;align-items:center;gap:8px;color:#2563eb;font-size:10px;font-weight:900;letter-spacing:.15em}.twin-header h1{margin:10px 0 8px;font-size:38px;font-weight:950;letter-spacing:-.045em}.twin-header p{max-width:760px;margin:0;color:#64748b;line-height:1.6}.refresh{display:inline-flex;align-items:center;gap:8px;flex-shrink:0;padding:11px 15px;border:1px solid #bfdbfe;border-radius:12px;background:rgba(255,255,255,.9);color:#1d4ed8;font-family:inherit;font-size:11px;font-weight:850;cursor:pointer;box-shadow:0 10px 28px rgba(37,99,235,.08)}.refresh:disabled{opacity:.6;cursor:wait}.spin{animation:spin .8s linear infinite}.error-banner{margin:18px 0 0;padding:12px 14px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#b91c1c;font-size:12px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin:28px 0 16px}.twin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin-top:15px}.twin-grid-main{align-items:stretch}.panel{border:1px solid rgba(148,163,184,.2);border-radius:20px;background:rgba(255,255,255,.92);box-shadow:0 18px 52px rgba(15,23,42,.065);padding:21px}.state-stats,.profile-stack{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:17px}.identity-list{display:grid;gap:8px;margin-top:16px}.identity-list>div{display:flex;align-items:center;justify-content:space-between;gap:15px;border-top:1px solid #eef2f7;padding-top:8px}.identity-list span{color:#64748b;font-size:10px;text-transform:capitalize}.identity-list strong{max-width:60%;overflow:hidden;color:#334155;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.goal-list{display:grid;gap:11px;margin-top:17px}.goal-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:11px 12px;border:1px solid #e7eef8;border-radius:13px;background:#fbfdff}.goal-copy{min-width:0;display:grid;gap:3px}.goal-copy strong{overflow:hidden;color:#1e293b;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.goal-copy span{color:#94a3b8;font-size:9px}.goal-progress{width:120px;flex-shrink:0;text-align:right}.goal-progress strong{color:#2563eb;font-size:11px}.goal-progress>div{height:6px;margin-top:5px;border-radius:999px;background:#e5edf8;overflow:hidden}.goal-progress>div span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#60a5fa)}.priorities-panel{margin-top:15px}.priority-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px;margin-top:16px}.priority-list article{display:flex;gap:11px;padding:14px;border:1px solid #e7eef8;border-radius:14px;background:#fbfdff}.priority-rank{width:28px;height:28px;flex-shrink:0;display:grid;place-items:center;border-radius:9px;background:#071226;color:white;font-size:10px;font-weight:900}.priority-list strong{color:#1e293b;font-size:11px}.priority-list p{margin:5px 0;color:#64748b;font-size:10px;line-height:1.45}.priority-list small{color:#2563eb;font-size:9px;line-height:1.4}.twin-footer{display:flex;justify-content:space-between;gap:20px;margin-top:18px;padding:0 4px;color:#94a3b8;font-size:9px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.twin-grid{grid-template-columns:1fr}.priority-list{grid-template-columns:1fr}}@media(max-width:620px){.twin-page{padding:25px 14px 60px}.twin-header{display:grid}.refresh{width:100%;justify-content:center}.metrics{grid-template-columns:1fr}.state-stats,.profile-stack{grid-template-columns:1fr}.twin-header h1{font-size:31px}.goal-row{align-items:flex-start;flex-direction:column}.goal-progress{width:100%;text-align:left}.twin-footer{display:grid}}
      `}</style>
    </main>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <article className="metric">
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
      <style jsx>{`
        .metric{display:grid;grid-template-columns:auto 1fr;column-gap:11px;align-items:center;border:1px solid rgba(148,163,184,.2);border-radius:16px;background:rgba(255,255,255,.92);box-shadow:0 13px 36px rgba(15,23,42,.05);padding:17px}.metric span{grid-row:1/3;color:#2563eb}.metric strong{color:#071226;font-size:23px;font-weight:950}.metric small{color:#64748b;font-size:10px}
      `}</style>
    </article>
  );
}

function PanelTitle({
  icon,
  eyebrow,
  title,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="panel-title">
      <span>{icon}</span>
      <div>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
      </div>
      <style jsx>{`
        .panel-title{display:flex;align-items:center;gap:10px}.panel-title>span{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#eff6ff;color:#2563eb}.panel-title div{display:grid;gap:2px}.panel-title small{color:#2563eb;font-size:8px;font-weight:900;letter-spacing:.13em}.panel-title strong{color:#0f172a;font-size:14px}
      `}</style>
    </div>
  );
}

function StateStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="state-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <style jsx>{`
        .state-stat{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;border:1px solid #e8eef7;border-radius:11px;background:#fbfdff}.state-stat span{color:#64748b;font-size:9px}.state-stat strong{color:#0f172a;font-size:12px}
      `}</style>
    </div>
  );
}

function SignalList({
  items,
  empty,
}: {
  items: Array<{ title: string; detail: string }>;
  empty: string;
}) {
  if (!items.length) return <EmptyLine text={empty} />;

  return (
    <div className="signal-list">
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`}>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </div>
      ))}
      <style jsx>{`
        .signal-list{display:grid;gap:9px;margin-top:16px}.signal-list>div{padding:10px 11px;border:1px solid #e8eef7;border-radius:11px;background:#fbfdff}.signal-list strong{color:#1e293b;font-size:10px}.signal-list p{margin:4px 0 0;color:#64748b;font-size:9px;line-height:1.45}
      `}</style>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="empty-line">
      {text}
      <style jsx>{`
        .empty-line{margin-top:16px;padding:14px;border:1px dashed #dbe4f0;border-radius:12px;color:#94a3b8;font-size:10px;line-height:1.5}
      `}</style>
    </div>
  );
}

const stateStyles = `
  .twin-state{min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:30px;color:#cbd5e1;text-align:center}.twin-state strong{color:#f8fafc}.twin-state span{color:#94a3b8;font-size:12px}.twin-state button{margin-top:5px;padding:9px 14px;border:1px solid #3b82f6;border-radius:10px;background:#1d4ed8;color:white;cursor:pointer}.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
`;
