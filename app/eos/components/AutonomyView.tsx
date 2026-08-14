"use client";

import {
  Check,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Profile = {
  default_level: number;
  max_auto_actions_per_day: number;
  max_daily_risk_points: number;
  approval_ttl_minutes: number;
  enabled: boolean;
};

type Rule = {
  accion: string;
  autonomy_level: number;
  risk_tier: number;
  risk_points: number;
  max_auto_per_day: number | null;
  enabled: boolean;
  require_fresh_context: boolean;
};

type Approval = {
  id: string;
  accion: string;
  risk_tier: number;
  risk_points: number;
  effective_level: number;
  status: string;
  reason: string | null;
  expires_at: string;
  created_at: string;
};

type Payload = {
  profile: Profile;
  rules: Rule[];
  pending_approvals: Approval[];
};

type ActionDefinition = {
  accion: string;
  label: string;
  description: string;
  riskTier: number;
  riskPoints: number;
  maxLevel: number;
};

const ACTIONS: ActionDefinition[] = [
  { accion: "RESPONDER", label: "Responder", description: "Responder dentro del chat.", riskTier: 0, riskPoints: 0, maxLevel: 3 },
  { accion: "VER_DASHBOARD", label: "Consultar dashboard", description: "Leer indicadores del Centro de Control.", riskTier: 0, riskPoints: 0, maxLevel: 3 },
  { accion: "VER_BRIEFING", label: "Consultar briefing", description: "Leer el briefing ejecutivo vigente.", riskTier: 0, riskPoints: 0, maxLevel: 3 },
  { accion: "GUARDAR_MEMORIA", label: "Guardar memoria", description: "Persistir información útil para futuras conversaciones.", riskTier: 1, riskPoints: 1, maxLevel: 3 },
  { accion: "GENERAR_EXCEL", label: "Generar Excel", description: "Preparar un archivo Excel solicitado.", riskTier: 1, riskPoints: 1, maxLevel: 3 },
  { accion: "GENERAR_PDF", label: "Generar PDF", description: "Preparar un documento PDF solicitado.", riskTier: 1, riskPoints: 1, maxLevel: 3 },
  { accion: "GENERAR_WORD", label: "Generar Word", description: "Preparar un documento Word solicitado.", riskTier: 1, riskPoints: 1, maxLevel: 3 },
  { accion: "CREAR_TAREA", label: "Crear tarea", description: "Crear una tarea operativa en EOS.", riskTier: 1, riskPoints: 2, maxLevel: 3 },
  { accion: "CREAR_OBJETIVO", label: "Crear objetivo", description: "Crear un objetivo vivo. Siempre requiere aprobación como mínimo.", riskTier: 2, riskPoints: 4, maxLevel: 2 },
];

const LEVELS = [
  { value: 0, label: "Recomendar" },
  { value: 1, label: "Preparar" },
  { value: 2, label: "Pedir aprobación" },
  { value: 3, label: "Automático" },
];

function levelLabel(level: number) {
  return LEVELS.find((item) => item.value === level)?.label || "Preparar";
}

export default function AutonomyView() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [busyApproval, setBusyApproval] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/autonomy", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo cargar Autonomía.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar Autonomía.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rulesByAction = useMemo(() => {
    return new Map((data?.rules || []).map((rule) => [rule.accion, rule]));
  }, [data?.rules]);

  async function saveProfile(profile: Profile) {
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/autonomy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo guardar Autonomía.");
      setData((current) => current ? { ...current, profile: payload.profile } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar Autonomía.");
    } finally {
      setSaving(false);
    }
  }

  async function saveActionRule(
    definition: ActionDefinition,
    changes: { level?: number; requireFreshContext?: boolean },
  ) {
    const current = rulesByAction.get(definition.accion);
    const requestedLevel = changes.level ?? current?.autonomy_level ?? data?.profile.default_level ?? 1;
    const level = Math.min(requestedLevel, definition.maxLevel);
    const requireFreshContext =
      changes.requireFreshContext ?? current?.require_fresh_context ?? true;

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/autonomy/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: definition.accion,
          autonomy_level: level,
          risk_tier: Math.max(definition.riskTier, current?.risk_tier || 0),
          risk_points: Math.max(definition.riskPoints, current?.risk_points || 0),
          max_auto_per_day: current?.max_auto_per_day ?? null,
          enabled: current?.enabled ?? true,
          require_fresh_context: requireFreshContext,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo guardar la regla.");

      setData((state) => {
        if (!state) return state;
        const without = state.rules.filter((rule) => rule.accion !== definition.accion);
        return { ...state, rules: [...without, payload.rule] };
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la regla.");
    } finally {
      setSaving(false);
    }
  }

  async function decideApproval(id: string, status: "approved" | "rejected") {
    setBusyApproval(id);
    setError("");

    try {
      const response = await fetch(`/api/autonomy/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo registrar la decisión.");
      setData((state) => state ? {
        ...state,
        pending_approvals: state.pending_approvals.filter((item) => item.id !== id),
      } : state);
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "No se pudo registrar la decisión.");
    } finally {
      setBusyApproval(null);
    }
  }

  if (loading) {
    return (
      <div className="autonomy-state">
        <LoaderCircle className="spin" size={24} />
        <span>Cargando controles de autonomía…</span>
        <style jsx>{stateStyles}</style>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="autonomy-state">
        <ShieldCheck size={25} />
        <strong>No pudimos cargar Autonomía.</strong>
        <button type="button" onClick={() => void load()}>Reintentar</button>
        <style jsx>{stateStyles}</style>
      </div>
    );
  }

  const profile = data.profile;

  return (
    <section className="autonomy-view">
      <header className="autonomy-header">
        <div>
          <span className="eyebrow">GOBIERNO DE EJECUCIÓN</span>
          <h1>Autonomía de EOS</h1>
          <p>Definí qué puede recomendar, preparar, ejecutar con aprobación o automatizar EOS.</p>
        </div>
        <button type="button" className="refresh" onClick={() => void load()} disabled={saving}>
          <RefreshCw size={15} /> Actualizar
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="summary-grid">
        <article className="summary-card">
          <ShieldCheck size={20} />
          <span>Nivel predeterminado</span>
          <strong>{levelLabel(profile.default_level)}</strong>
        </article>
        <article className="summary-card">
          <SlidersHorizontal size={20} />
          <span>Acciones automáticas / día</span>
          <strong>{profile.max_auto_actions_per_day}</strong>
        </article>
        <article className="summary-card">
          <ShieldCheck size={20} />
          <span>Presupuesto de riesgo / día</span>
          <strong>{profile.max_daily_risk_points} pts</strong>
        </article>
        <article className="summary-card">
          <ShieldCheck size={20} />
          <span>Aprobaciones pendientes</span>
          <strong>{data.pending_approvals.length}</strong>
        </article>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Política general</h2>
            <p>Se aplica cuando una acción no tiene una regla específica.</p>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={profile.enabled}
              onChange={(event) => void saveProfile({ ...profile, enabled: event.target.checked })}
            />
            Autonomía activa
          </label>
        </div>

        <div className="profile-controls">
          <label>
            <span>Nivel predeterminado</span>
            <select
              value={profile.default_level}
              onChange={(event) => void saveProfile({ ...profile, default_level: Number(event.target.value) })}
              disabled={saving}
            >
              {LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
            </select>
          </label>
          <label>
            <span>Máx. acciones automáticas / día</span>
            <input
              type="number"
              min={0}
              max={100}
              value={profile.max_auto_actions_per_day}
              onChange={(event) => setData((state) => state ? { ...state, profile: { ...state.profile, max_auto_actions_per_day: Number(event.target.value) } } : state)}
              onBlur={() => void saveProfile(data.profile)}
            />
          </label>
          <label>
            <span>Máx. puntos de riesgo / día</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={profile.max_daily_risk_points}
              onChange={(event) => setData((state) => state ? { ...state, profile: { ...state.profile, max_daily_risk_points: Number(event.target.value) } } : state)}
              onBlur={() => void saveProfile(data.profile)}
            />
          </label>
          <label>
            <span>Vigencia de aprobación (min)</span>
            <input
              type="number"
              min={5}
              max={10080}
              value={profile.approval_ttl_minutes}
              onChange={(event) => setData((state) => state ? { ...state, profile: { ...state.profile, approval_ttl_minutes: Number(event.target.value) } } : state)}
              onBlur={() => void saveProfile(data.profile)}
            />
          </label>
        </div>
      </div>

      {data.pending_approvals.length > 0 && (
        <div className="panel approvals-panel">
          <div className="panel-heading">
            <div>
              <h2>Requieren tu aprobación</h2>
              <p>EOS no ejecutará estas acciones hasta recibir una decisión.</p>
            </div>
          </div>
          <div className="approval-list">
            {data.pending_approvals.map((approval) => (
              <article className="approval-card" key={approval.id}>
                <div>
                  <strong>{ACTIONS.find((item) => item.accion === approval.accion)?.label || approval.accion}</strong>
                  <p>{approval.reason || "Esta acción requiere aprobación explícita."}</p>
                  <small>Riesgo {approval.risk_tier} · {approval.risk_points} pts · vence {new Date(approval.expires_at).toLocaleString("es-PY")}</small>
                </div>
                <div className="approval-actions">
                  <button type="button" className="reject" disabled={busyApproval === approval.id} onClick={() => void decideApproval(approval.id, "rejected")}>
                    <X size={14} /> Rechazar
                  </button>
                  <button type="button" className="approve" disabled={busyApproval === approval.id} onClick={() => void decideApproval(approval.id, "approved")}>
                    {busyApproval === approval.id ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Aprobar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Reglas por acción</h2>
            <p>El riesgo y el nivel máximo de sistema no pueden rebajarse desde esta pantalla.</p>
          </div>
        </div>
        <div className="rules-list">
          {ACTIONS.map((definition) => {
            const rule = rulesByAction.get(definition.accion);
            const configuredLevel = rule?.autonomy_level ?? profile.default_level;
            const level = Math.min(configuredLevel, definition.maxLevel);
            const requireFreshContext = rule?.require_fresh_context ?? true;
            return (
              <article className="rule-card" key={definition.accion}>
                <div className="rule-copy">
                  <strong>{definition.label}</strong>
                  <p>{definition.description}</p>
                  <small>
                    Riesgo mínimo EOS: nivel {definition.riskTier} · {definition.riskPoints} pts
                    {definition.maxLevel < 3 ? " · máximo permitido: Pedir aprobación" : ""}
                  </small>
                </div>
                <div className="rule-controls">
                  <select
                    value={level}
                    disabled={saving}
                    onChange={(event) => void saveActionRule(definition, { level: Number(event.target.value) })}
                  >
                    {LEVELS.filter((item) => item.value <= definition.maxLevel).map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                  <label className="fresh-context-toggle">
                    <input
                      type="checkbox"
                      checked={requireFreshContext}
                      disabled={saving}
                      onChange={(event) => void saveActionRule(definition, { requireFreshContext: event.target.checked })}
                    />
                    <span>Exigir Contexto Maestro vigente</span>
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .autonomy-view { width: 100%; max-width: 1180px; margin: 0 auto; padding: 34px 30px 70px; box-sizing: border-box; color: #e5eefb; }
        .autonomy-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 22px; margin-bottom: 24px; }
        .eyebrow { color: #60a5fa; font-size: 10px; font-weight: 900; letter-spacing: .15em; }
        h1 { margin: 7px 0 8px; font-size: 30px; color: #fff; }
        .autonomy-header p, .panel-heading p, .rule-copy p, .approval-card p { margin: 0; color: #94a3b8; line-height: 1.55; }
        .refresh { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid rgba(96,165,250,.3); border-radius: 12px; background: rgba(37,99,235,.12); color: #bfdbfe; cursor: pointer; }
        .error-banner { margin-bottom: 18px; padding: 12px 14px; border: 1px solid rgba(248,113,113,.3); border-radius: 12px; background: rgba(127,29,29,.25); color: #fecaca; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin-bottom: 18px; }
        .summary-card, .panel { border: 1px solid rgba(148,163,184,.16); background: rgba(15,23,42,.62); box-shadow: 0 16px 45px rgba(0,0,0,.12); backdrop-filter: blur(16px); }
        .summary-card { min-height: 120px; display: flex; flex-direction: column; gap: 8px; padding: 18px; border-radius: 17px; }
        .summary-card svg { color: #60a5fa; }
        .summary-card span { color: #94a3b8; font-size: 11px; }
        .summary-card strong { margin-top: auto; color: #fff; font-size: 20px; }
        .panel { margin-top: 16px; padding: 20px; border-radius: 18px; }
        .panel-heading { display: flex; justify-content: space-between; align-items: center; gap: 18px; margin-bottom: 18px; }
        h2 { margin: 0 0 5px; color: #fff; font-size: 17px; }
        .toggle-row { display: flex; gap: 8px; align-items: center; color: #dbeafe; font-size: 12px; }
        .profile-controls { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }
        label > span { display: block; margin-bottom: 7px; color: #94a3b8; font-size: 10px; font-weight: 750; }
        select, input[type="number"] { width: 100%; min-height: 40px; box-sizing: border-box; border: 1px solid rgba(148,163,184,.22); border-radius: 11px; outline: none; padding: 0 10px; background: #0b1728; color: #e5eefb; font-family: inherit; }
        .rules-list, .approval-list { display: grid; gap: 10px; }
        .rule-card, .approval-card { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 15px; border: 1px solid rgba(148,163,184,.13); border-radius: 14px; background: rgba(8,19,34,.58); }
        .rule-copy { min-width: 0; flex: 1; }
        .rule-copy strong, .approval-card strong { color: #f8fafc; font-size: 13px; }
        .rule-copy p, .approval-card p { margin-top: 4px; font-size: 11px; }
        .rule-copy small, .approval-card small { display: block; margin-top: 6px; color: #64748b; font-size: 9px; }
        .rule-controls { width: 230px; flex-shrink: 0; display: grid; gap: 9px; }
        .rule-controls select { width: 100%; }
        .fresh-context-toggle { display: flex; align-items: center; gap: 7px; color: #cbd5e1; font-size: 10px; line-height: 1.35; cursor: pointer; }
        .fresh-context-toggle span { display: inline; margin: 0; color: #94a3b8; font-size: 9px; font-weight: 650; }
        .approval-actions { display: flex; gap: 8px; flex-shrink: 0; }
        .approval-actions button { display: inline-flex; align-items: center; gap: 6px; padding: 9px 12px; border-radius: 10px; font-family: inherit; font-size: 10px; font-weight: 800; cursor: pointer; }
        .reject { border: 1px solid rgba(248,113,113,.28); background: rgba(127,29,29,.22); color: #fecaca; }
        .approve { border: 1px solid rgba(74,222,128,.28); background: rgba(20,83,45,.3); color: #bbf7d0; }
        .spin { animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) { .summary-grid, .profile-controls { grid-template-columns: repeat(2,minmax(0,1fr)); } }
        @media (max-width: 620px) { .autonomy-view { padding: 24px 14px 50px; } .autonomy-header, .panel-heading, .rule-card, .approval-card { flex-direction: column; align-items: stretch; } .summary-grid, .profile-controls { grid-template-columns: 1fr; } .rule-controls { width: 100%; } .approval-actions button { flex: 1; justify-content: center; } }
      `}</style>
    </section>
  );
}

const stateStyles = `
  .autonomy-state { min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #cbd5e1; }
  .autonomy-state button { padding: 9px 13px; border: 1px solid #3b82f6; border-radius: 10px; background: #1d4ed8; color: white; cursor: pointer; }
  .spin { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
