"use client";

import { AlertTriangle, Brain, Building2, CheckCircle2, Flag, FolderKanban, RefreshCw, Scale, Sparkles, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Item = Record<string, unknown>;

type MasterContext = {
  version: number;
  identidad: Item;
  estado_actual: Item;
  objetivos: Item[];
  proyectos: Item[];
  compromisos: Item[];
  alertas: Item[];
  decisiones_recientes: Item[];
  aprendizajes: Item[];
  proxima_mejor_accion: Item;
  generado_at: string;
  necesita_actualizacion?: boolean;
  antiguedad_minutos?: number;
};

export default function MasterContextView({ onOpenChat }: { onOpenChat: (prompt: string) => void }) {
  const [context, setContext] = useState<MasterContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/context/master", {
        method: refresh ? "POST" : "GET",
        headers: refresh ? { "Content-Type": "application/json" } : undefined,
        body: refresh ? JSON.stringify({ request_id: crypto.randomUUID(), trigger_source: "eos-context-view" }) : undefined,
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No pudimos cargar el contexto.");
      setContext(payload.context ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar el contexto.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const identity = context?.identidad ?? {};
  const current = context?.estado_actual ?? {};
  const next = context?.proxima_mejor_accion ?? {};

  return (
    <main className="context-page">
      <div className="context-container">
        <header className="context-header">
          <div>
            <span className="eyebrow"><Brain size={16} /> CONTEXTO MAESTRO EOS</span>
            <h1>Tu realidad, en una sola vista</h1>
            <p>EOS sintetiza lo importante sin cargar toda tu memoria en cada conversación.</p>
          </div>
          <button className="secondary" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? "spinning" : ""} />
            {refreshing ? "Actualizando…" : "Actualizar contexto"}
          </button>
        </header>

        {error ? <div className="error">{error}</div> : null}
        {loading ? <div className="empty">Construyendo tu Contexto Maestro…</div> : null}

        {context ? (
          <>
            <section className="identity-card">
              <div className="identity-icon"><Building2 size={25} /></div>
              <div><small>IDENTIDAD</small><h2>{text(identity.nombre, "Perfil empresarial")}</h2><p>{[text(identity.sector), text(identity.etapa), text(identity.tipo)].filter(Boolean).join(" · ") || "Completá tu perfil para mejorar el análisis."}</p></div>
              <div className="score"><strong>{number(current.score, "—")}</strong><span>EOS Score</span></div>
            </section>

            <section className="summary-grid">
              <Summary title="Estado actual" icon={<Sparkles size={18} />} value={text(current.resumen, "Todavía no hay un diagnóstico consolidado.")} detail={`Prioridad: ${text(current.prioridad, "por definir")}`} />
              <Summary title="Objetivos activos" icon={<Target size={18} />} value={String(context.objetivos.length)} detail={firstTitle(context.objetivos, "Sin objetivos activos")} />
              <Summary title="Alertas" icon={<AlertTriangle size={18} />} value={String(context.alertas.length)} detail={firstTitle(context.alertas, "Sin alertas activas")} />
              <Summary title="Decisiones recientes" icon={<Scale size={18} />} value={String(context.decisiones_recientes.length)} detail={firstTitle(context.decisiones_recientes, "Sin decisiones registradas")} />
            </section>

            <section className="next-action">
              <div className="next-icon"><Flag size={24} /></div>
              <div><small>PRÓXIMA MEJOR ACCIÓN</small><h2>{text(next.titulo, "Definir el próximo resultado importante")}</h2><p>{text(next.razon, "EOS necesita más señales para priorizar con precisión.")}</p></div>
              <button className="primary" onClick={() => onOpenChat(`Quiero trabajar ahora sobre esta próxima mejor acción: ${text(next.titulo, "ayudame a definir mi prioridad")}`)}>Trabajar con EOS</button>
            </section>

            <section className="detail-grid">
              <ContextList title="Objetivos" icon={<Target size={18} />} items={context.objetivos} empty="No hay objetivos activos." />
              <ContextList title="Proyectos" icon={<FolderKanban size={18} />} items={context.proyectos} empty="No hay proyectos activos." />
              <ContextList title="Compromisos" icon={<CheckCircle2 size={18} />} items={context.compromisos} empty="No hay compromisos pendientes." />
              <ContextList title="Aprendizajes" icon={<Brain size={18} />} items={context.aprendizajes} empty="EOS todavía está reuniendo evidencia." />
            </section>

            <footer>Contexto v{context.version} · actualizado {formatAge(context.antiguedad_minutos, context.generado_at)}{context.necesita_actualizacion ? " · requiere actualización" : " · vigente"}</footer>
          </>
        ) : null}
      </div>

      <style jsx>{`
        .context-page{min-height:100%;padding:38px 28px 70px;background:radial-gradient(circle at 85% 8%,rgba(37,99,235,.11),transparent 28%),linear-gradient(145deg,#fff 0%,#f7faff 52%,#eef5ff 100%);color:#071226;font-family:Inter,Arial,Helvetica,sans-serif}.context-container{max-width:1180px;margin:auto}.context-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}.eyebrow{display:flex;align-items:center;gap:8px;color:#2563eb;font-size:11px;font-weight:900;letter-spacing:.14em}.context-header h1{margin:12px 0 8px;font-size:38px;font-weight:900;letter-spacing:-.04em}.context-header p{margin:0;color:#64748b;line-height:1.6}.primary,.secondary{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;padding:12px 16px;font:800 14px inherit;cursor:pointer}.primary{border:0;background:#2563eb;color:white;box-shadow:0 14px 30px rgba(37,99,235,.2)}.secondary{border:1px solid #dbeafe;background:rgba(255,255,255,.9);color:#2563eb}.identity-card,.next-action,.summary-grid>*,.detail-grid>*,.empty{border:1px solid rgba(148,163,184,.2);background:rgba(255,255,255,.92);box-shadow:0 17px 48px rgba(15,23,42,.065)}.identity-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px;margin:30px 0 14px;padding:22px;border-radius:20px}.identity-icon,.next-icon{display:grid;place-items:center;width:52px;height:52px;border-radius:15px;background:#dbeafe;color:#2563eb}.identity-card small,.next-action small{color:#2563eb;font-size:10px;font-weight:900;letter-spacing:.13em}.identity-card h2,.next-action h2{margin:5px 0;color:#071226}.identity-card p,.next-action p{margin:0;color:#64748b}.score{display:grid;text-align:right}.score strong{font-size:28px}.score span{color:#64748b;font-size:11px}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.next-action{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;margin:14px 0;padding:22px;border-radius:20px;background:linear-gradient(130deg,#071226,#102b59);color:white}.next-action h2{color:white}.next-action p{color:#bfdbfe}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.error{margin:22px 0;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#b91c1c;padding:14px}.empty{margin-top:28px;border-radius:20px;padding:44px;color:#64748b;text-align:center}footer{margin-top:18px;color:#94a3b8;font-size:12px}.spinning{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.summary-grid{grid-template-columns:1fr 1fr}.detail-grid{grid-template-columns:1fr}}@media(max-width:640px){.context-page{padding:26px 16px 60px}.context-header{display:grid}.context-header h1{font-size:30px}.secondary{width:100%}.identity-card,.next-action{grid-template-columns:auto 1fr}.score,.next-action .primary{grid-column:1/-1;width:100%;text-align:left}.summary-grid{grid-template-columns:1fr}}
      `}</style>
    </main>
  );
}

function Summary({ title, icon, value, detail }: { title: string; icon: React.ReactNode; value: string; detail: string }) {
  return <article className="summary"><span>{icon}</span><small>{title}</small><strong>{value}</strong><p>{detail}</p><style jsx>{`.summary{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;padding:17px;border-radius:16px}.summary span{grid-row:1/3;color:#2563eb}.summary small{color:#64748b;font-size:11px}.summary strong{font-size:23px}.summary p{grid-column:1/-1;margin:8px 0 0;color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`}</style></article>;
}

function ContextList({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: Item[]; empty: string }) {
  return <article className="list"><h3><span>{icon}</span>{title}<b>{items.length}</b></h3>{items.length ? <ul>{items.slice(0, 5).map((item, index) => <li key={String(item.id || index)}><strong>{text(item.titulo || item.nombre || item.patron || item.recomendacion, "Elemento sin título")}</strong><small>{item.progreso !== undefined ? `${number(item.progreso, 0)}% de progreso` : text(item.estado || item.razon || item.tendencia)}</small></li>)}</ul> : <p>{empty}</p>}<style jsx>{`.list{padding:20px;border-radius:18px}.list h3{display:flex;align-items:center;gap:9px;margin:0 0 15px}.list h3 span{color:#2563eb}.list h3 b{margin-left:auto;border-radius:999px;background:#dbeafe;color:#2563eb;padding:4px 8px;font-size:11px}.list ul{display:grid;gap:10px;margin:0;padding:0;list-style:none}.list li{display:grid;gap:4px;border-top:1px solid #e2e8f0;padding-top:10px}.list li:first-child{border:0;padding-top:0}.list li strong{font-size:13px}.list li small,.list>p{color:#64748b;font-size:11px}.list>p{margin:0}`}</style></article>;
}

function text(value: unknown, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function number(value: unknown, fallback: number | string) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function firstTitle(items: Item[], fallback: string) { return text(items[0]?.titulo || items[0]?.nombre || items[0]?.patron, fallback); }
function formatAge(minutes: number | undefined, date: string) {
  if (typeof minutes === "number") return minutes < 1 ? "ahora" : `hace ${minutes} min`;
  return new Intl.DateTimeFormat("es-PY", { dateStyle: "short", timeStyle: "short" }).format(new Date(date));
}
