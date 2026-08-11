"use client";

import { CalendarDays, CheckCircle2, Plus, RefreshCw, Scale, TrendingUp } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Decision = {
  id: string;
  titulo: string;
  decision: string;
  razon: string | null;
  resultado_esperado: string | null;
  estado: string;
  fecha_decision: string;
  fecha_revision: string | null;
  result_count: number;
  latest_result_type: string | null;
  latest_result_summary: string | null;
  latest_learning: string | null;
};

const emptyDecision = {
  titulo: "",
  decision: "",
  razon: "",
  resultado_esperado: "",
  fecha_revision: "",
};

export default function DecisionsView() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyDecision);
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [result, setResult] = useState({ tipo: "observacion", resumen: "", aprendizaje: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/decisions", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setDecisions(payload.decisions ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar las decisiones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function createDecision(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setForm(emptyDecision);
      setShowForm(false);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pudimos guardar la decisión.");
    } finally {
      setSaving(false);
    }
  }

  async function createResult(event: FormEvent, decisionId: string) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/decisions/${decisionId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setResult({ tipo: "observacion", resumen: "", aprendizaje: "" });
      setResultFor(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pudimos guardar el resultado.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="decisions-page">
      <div className="decisions-container">
        <header className="decisions-header">
          <div>
            <span className="eyebrow"><Scale size={15} /> MEMORIA EJECUTIVA</span>
            <h1>Decisiones y resultados</h1>
            <p>Registrá qué decidiste, por qué y qué ocurrió. EOS conservará la evidencia para aprender.</p>
          </div>
          <div className="header-actions">
            <button className="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /> Actualizar</button>
            <button className="primary" onClick={() => setShowForm((value) => !value)}><Plus size={18} /> Nueva decisión</button>
          </div>
        </header>

        <section className="stats">
          <Stat label="Decisiones" value={decisions.length} icon={<Scale size={20} />} />
          <Stat label="Con resultados" value={decisions.filter((item) => item.result_count > 0).length} icon={<CheckCircle2 size={20} />} />
          <Stat label="Pendientes de medir" value={decisions.filter((item) => item.result_count === 0).length} icon={<TrendingUp size={20} />} />
        </section>

        {showForm ? (
          <form className="editor" onSubmit={createDecision}>
            <h2>Registrar una decisión</h2>
            <div className="form-grid">
              <label>Título<input required value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej. Cambiar el canal principal de ventas" /></label>
              <label>Fecha de revisión<input type="date" value={form.fecha_revision} onChange={(e) => setForm({ ...form, fecha_revision: e.target.value })} /></label>
              <label className="wide">Decisión<textarea required value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })} placeholder="Qué se decidió exactamente" /></label>
              <label>Razón<textarea value={form.razon} onChange={(e) => setForm({ ...form, razon: e.target.value })} placeholder="Por qué se eligió" /></label>
              <label>Resultado esperado<textarea value={form.resultado_esperado} onChange={(e) => setForm({ ...form, resultado_esperado: e.target.value })} placeholder="Qué debería ocurrir" /></label>
            </div>
            <div className="form-actions"><button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary" disabled={saving}>{saving ? "Guardando…" : "Guardar decisión"}</button></div>
          </form>
        ) : null}

        {error ? <div className="error">{error}</div> : null}

        <section className="decision-list">
          {loading ? <div className="empty">Cargando registro…</div> : null}
          {!loading && decisions.length === 0 ? <div className="empty"><Scale size={28} /><strong>Todavía no hay decisiones registradas</strong><p>Creá la primera para comenzar a medir resultados reales.</p></div> : null}
          {decisions.map((item) => (
            <article className="decision-card" key={item.id}>
              <div className="card-top"><div><span className="status">{item.estado.replace("_", " ")}</span><h2>{item.titulo}</h2></div><span className="date"><CalendarDays size={15} /> {formatDate(item.fecha_decision)}</span></div>
              <p className="decision-text">{item.decision}</p>
              <div className="details">
                {item.razon ? <div><small>CRITERIO</small><p>{item.razon}</p></div> : null}
                {item.resultado_esperado ? <div><small>RESULTADO ESPERADO</small><p>{item.resultado_esperado}</p></div> : null}
              </div>
              {item.latest_result_summary ? <div className={`latest result-${item.latest_result_type}`}><div><small>ÚLTIMO RESULTADO · {item.latest_result_type}</small><p>{item.latest_result_summary}</p>{item.latest_learning ? <span>Aprendizaje: {item.latest_learning}</span> : null}</div><strong>{item.result_count}</strong></div> : null}
              {resultFor === item.id ? (
                <form className="result-form" onSubmit={(event) => createResult(event, item.id)}>
                  <select value={result.tipo} onChange={(e) => setResult({ ...result, tipo: e.target.value })}><option value="positivo">Positivo</option><option value="neutral">Neutral</option><option value="negativo">Negativo</option><option value="inconcluso">Inconcluso</option><option value="observacion">Observación</option></select>
                  <input required value={result.resumen} onChange={(e) => setResult({ ...result, resumen: e.target.value })} placeholder="Qué ocurrió" />
                  <input value={result.aprendizaje} onChange={(e) => setResult({ ...result, aprendizaje: e.target.value })} placeholder="Qué aprendimos" />
                  <button className="primary" disabled={saving}>Registrar</button>
                </form>
              ) : <button className="result-button" onClick={() => setResultFor(item.id)}><Plus size={16} /> Añadir resultado</button>}
            </article>
          ))}
        </section>
      </div>
      <style jsx>{`
        .decisions-page{min-height:100%;background:radial-gradient(circle at 85% 8%,rgba(37,99,235,.14),transparent 28%),#07111f;color:#e8f0fb;padding:38px 28px 70px}.decisions-container{max-width:1180px;margin:auto}.decisions-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.eyebrow{display:flex;gap:8px;align-items:center;color:#60a5fa;font-size:11px;font-weight:900;letter-spacing:.14em}.decisions-header h1{font-size:38px;margin:12px 0 8px;letter-spacing:-.04em}.decisions-header p{color:#94a3b8;max-width:680px;margin:0;line-height:1.6}.header-actions,.form-actions{display:flex;gap:10px}.primary,.secondary,.result-button{border:0;border-radius:12px;padding:12px 16px;font-weight:800;display:inline-flex;gap:8px;align-items:center;justify-content:center;cursor:pointer}.primary{background:#2563eb;color:white}.secondary{background:#111f32;color:#cbd5e1;border:1px solid #25364e}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:30px 0}.editor,.decision-card,.empty{background:rgba(14,27,45,.9);border:1px solid #223550;border-radius:20px;padding:22px}.editor{margin-bottom:18px}.editor h2{margin:0 0 18px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.form-grid label{display:grid;gap:7px;color:#aebdd0;font-size:13px;font-weight:700}.wide{grid-column:1/-1}.form-grid input,.form-grid textarea,.result-form input,.result-form select{width:100%;box-sizing:border-box;background:#081424;border:1px solid #2a3c55;color:#e8f0fb;border-radius:11px;padding:12px;font:inherit}.form-grid textarea{min-height:86px;resize:vertical}.form-actions{justify-content:flex-end;margin-top:18px}.error{background:#43191d;border:1px solid #7f1d1d;color:#fecaca;padding:13px 16px;border-radius:12px;margin-bottom:16px}.decision-list{display:grid;gap:15px}.empty{text-align:center;color:#94a3b8;display:grid;justify-items:center;gap:8px;padding:44px}.empty strong{color:#e8f0fb}.card-top{display:flex;justify-content:space-between;gap:18px}.card-top h2{margin:9px 0 0;font-size:21px}.status{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#93c5fd;background:#132f57;padding:5px 8px;border-radius:999px}.date{color:#8293a9;font-size:12px;display:flex;gap:6px;align-items:center}.decision-text{color:#d7e2ef;line-height:1.6}.details{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.details>div{background:#091627;border:1px solid #1c2f48;border-radius:12px;padding:13px}.details small,.latest small{font-size:10px;color:#60a5fa;font-weight:900;letter-spacing:.12em}.details p,.latest p{margin:7px 0 0;color:#aebdd0;line-height:1.5}.latest{display:flex;justify-content:space-between;gap:16px;background:#0b1b2d;border-left:3px solid #60a5fa;border-radius:10px;padding:14px;margin-top:12px}.latest span{display:block;color:#7dd3fc;font-size:12px;margin-top:7px}.latest>strong{font-size:26px;color:#60a5fa}.result-positivo{border-left-color:#22c55e}.result-negativo{border-left-color:#ef4444}.result-form{display:grid;grid-template-columns:140px 1.3fr 1fr auto;gap:8px;margin-top:14px}.result-button{margin-top:14px;background:transparent;border:1px solid #2b4260;color:#93c5fd;padding:9px 12px}.stat{background:#0e1b2d;border:1px solid #223550;border-radius:16px;padding:18px}@media(max-width:800px){.decisions-page{padding:26px 16px 60px}.decisions-header{display:grid}.header-actions{width:100%}.header-actions button{flex:1}.stats,.form-grid,.details{grid-template-columns:1fr}.wide{grid-column:auto}.result-form{grid-template-columns:1fr}.decisions-header h1{font-size:30px}.card-top{display:grid}.date{justify-self:start}}
      `}</style>
    </main>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <article className="stat"><span>{icon}</span><strong>{value}</strong><small>{label}</small><style jsx>{`.stat{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:center}.stat span{grid-row:1/3;color:#60a5fa}.stat strong{font-size:25px}.stat small{color:#94a3b8}`}</style></article>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
