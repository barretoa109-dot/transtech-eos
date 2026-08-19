"use client";

import { CalendarDays, Plus, RefreshCw, Scale } from "lucide-react";
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

type Filtro = "todas" | "implementadas" | "curso" | "pendientes";

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "implementadas", label: "Implementadas" },
  { key: "curso", label: "En curso" },
  { key: "pendientes", label: "Pendientes" },
];

/** Mapea los 5 estados reales de `eos_decisions` a los 3 badges de la maqueta. */
function badgeInfo(item: Decision): { cls: string; label: string; dot: string; filtro: Filtro } {
  if (item.estado === "cerrada")
    return { cls: "done", label: "Implementada ✓", dot: "done", filtro: "implementadas" };
  if (item.estado === "cancelada")
    return { cls: "pending", label: "Cancelada", dot: "pending", filtro: "pendientes" };
  if (item.result_count > 0) return { cls: "progress", label: "En curso", dot: "progress", filtro: "curso" };
  return { cls: "pending", label: "Pendiente de resultado", dot: "", filtro: "pendientes" };
}

export default function DecisionsView() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyDecision);
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [result, setResult] = useState({ tipo: "observacion", resumen: "", aprendizaje: "" });
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");

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

  const decisionesVisibles =
    filtro === "todas" ? decisions : decisions.filter((item) => badgeInfo(item).filtro === filtro);

  return (
    <div className="view" id="view-decisiones">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Decisiones</div>
          <div className="page-title">Resultados y aprendizaje</div>
          <div className="page-sub">Historial de decisiones tomadas junto con EOS y su resultado.</div>
        </div>

        <div className="chip-row">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip ${filtro === f.key ? "active" : ""}`}
              onClick={() => setFiltro(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="chip-row">
          <button type="button" className="chip" onClick={() => void load()} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={12} className={loading ? "spin" : ""} />
            Actualizar
          </button>
          <button type="button" className="chip" onClick={() => setShowForm((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Plus size={12} />
            Nueva decisión
          </button>
        </div>

        {showForm && (
          <form className="card" onSubmit={createDecision} style={{ marginBottom: 14 }}>
            <div className="card-title">Registrar una decisión</div>
            <div className="decision-form-grid">
              <label className="decision-field">
                <span>Título</span>
                <input
                  required
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ej. Cambiar el canal principal de ventas"
                />
              </label>
              <label className="decision-field">
                <span>Fecha de revisión</span>
                <input type="date" value={form.fecha_revision} onChange={(e) => setForm({ ...form, fecha_revision: e.target.value })} />
              </label>
              <label className="decision-field decision-field-wide">
                <span>Decisión</span>
                <textarea
                  required
                  value={form.decision}
                  onChange={(e) => setForm({ ...form, decision: e.target.value })}
                  placeholder="Qué se decidió exactamente"
                />
              </label>
              <label className="decision-field">
                <span>Razón</span>
                <textarea value={form.razon} onChange={(e) => setForm({ ...form, razon: e.target.value })} placeholder="Por qué se eligió" />
              </label>
              <label className="decision-field">
                <span>Resultado esperado</span>
                <textarea
                  value={form.resultado_esperado}
                  onChange={(e) => setForm({ ...form, resultado_esperado: e.target.value })}
                  placeholder="Qué debería ocurrir"
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button type="button" className="chip" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button type="submit" className="reco-btn" disabled={saving}>
                {saving ? "Guardando…" : "Guardar decisión"}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 14 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="card empty-note">Cargando registro…</div>
        ) : decisions.length === 0 ? (
          <div className="card" style={{ textAlign: "center" }}>
            <Scale size={26} style={{ margin: "0 auto 10px", color: "var(--blue)" }} />
            <strong>Todavía no hay decisiones registradas</strong>
            <p className="empty-note" style={{ marginTop: 6 }}>
              Creá la primera para comenzar a medir resultados reales.
            </p>
          </div>
        ) : decisionesVisibles.length === 0 ? (
          <div className="card" style={{ textAlign: "center" }}>
            <p className="empty-note">No hay decisiones en esta categoría.</p>
          </div>
        ) : (
          <div className="timeline">
            {decisionesVisibles.map((item) => {
              const badge = badgeInfo(item);
              return (
                <div className="tl-item" key={item.id}>
                  <div className={`tl-dot ${badge.dot}`} />
                  <div className="tl-card">
                    <div className="tl-date">
                      <CalendarDays size={11} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
                      {formatDate(item.fecha_decision)}
                    </div>
                    <div className="tl-title">{item.titulo}</div>
                    <div className="tl-outcome">{item.decision}</div>

                    {item.razon && (
                      <div className="tl-outcome">
                        <strong>Criterio:</strong> {item.razon}
                      </div>
                    )}
                    {item.resultado_esperado && (
                      <div className="tl-outcome">
                        <strong>Resultado esperado:</strong> {item.resultado_esperado}
                      </div>
                    )}
                    {item.latest_result_summary && (
                      <div className="tl-outcome">
                        <strong>Último resultado ({item.latest_result_type}):</strong> {item.latest_result_summary}
                        {item.latest_learning && <div>Aprendizaje: {item.latest_learning}</div>}
                      </div>
                    )}

                    <span className={`badge ${badge.cls}`}>{badge.label}</span>

                    {resultFor === item.id ? (
                      <form className="decision-result-form" onSubmit={(event) => createResult(event, item.id)}>
                        <select value={result.tipo} onChange={(e) => setResult({ ...result, tipo: e.target.value })}>
                          <option value="positivo">Positivo</option>
                          <option value="neutral">Neutral</option>
                          <option value="negativo">Negativo</option>
                          <option value="inconcluso">Inconcluso</option>
                          <option value="observacion">Observación</option>
                        </select>
                        <input
                          required
                          value={result.resumen}
                          onChange={(e) => setResult({ ...result, resumen: e.target.value })}
                          placeholder="Qué ocurrió"
                        />
                        <input
                          value={result.aprendizaje}
                          onChange={(e) => setResult({ ...result, aprendizaje: e.target.value })}
                          placeholder="Qué aprendimos"
                        />
                        <button type="submit" className="reco-btn" disabled={saving}>
                          Registrar
                        </button>
                      </form>
                    ) : (
                      <button type="button" className="reco-btn" style={{ marginTop: 12 }} onClick={() => setResultFor(item.id)}>
                        <Plus size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
                        Añadir resultado
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style jsx>{`
        .decision-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-top: 14px;
        }
        .decision-field {
          display: grid;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: var(--muted);
        }
        .decision-field-wide {
          grid-column: 1 / -1;
        }
        .decision-field :global(input),
        .decision-field :global(textarea) {
          box-sizing: border-box;
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--line-soft);
          color: var(--ink);
          padding: 10px 12px;
          font: inherit;
        }
        .decision-field :global(textarea) {
          min-height: 70px;
          resize: vertical;
        }
        .decision-result-form {
          display: grid;
          grid-template-columns: 130px 1.3fr 1fr auto;
          gap: 8px;
          margin-top: 12px;
        }
        .decision-result-form :global(input),
        .decision-result-form :global(select) {
          box-sizing: border-box;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--line-soft);
          padding: 8px 10px;
          font: inherit;
        }
        .spin {
          animation: spin 800ms linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        @media (max-width: 700px) {
          .decision-form-grid {
            grid-template-columns: 1fr;
          }
          .decision-field-wide {
            grid-column: auto;
          }
          .decision-result-form {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}
