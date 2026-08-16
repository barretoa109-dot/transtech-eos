import { notFound } from "next/navigation";
import FinancialStateCard from "@/components/financial-autopilot/FinancialStateCard";
import type { FinancialStateView } from "@/lib/financial-autopilot/financial-state";

export const dynamic = "force-dynamic";

const SAFE_STATE: FinancialStateView = {
  version: "financial-state-v1",
  contextRevision: `ctx:${"1".repeat(64)}`,
  status: "SAFE",
  currency: "PYG",
  asOf: "2026-08-16T17:30:00.000Z",
  validUntil: "2026-08-17T12:00:00.000Z",
  headline: "Todo está bajo control.",
  detail: "No necesitas hacer nada.",
  canAssertSafety: true,
  money: {
    availableRealMinor: 1640000,
    protectedCommitmentsMinor: 2100000,
    protectedReserveMinor: 3000000,
  },
  nextProtectedCommitment: {
    type: "housing",
    amountMinor: 2100000,
    currency: "PYG",
    dueAt: "2026-08-25T00:00:00.000Z",
  },
  firstForecastRisk: null,
  attention: {
    required: false,
    interrupt: false,
    outcome: "NO_ACTION",
    message: "Todo está bajo control. No necesitas hacer nada.",
  },
  freshness: {
    status: "FRESH",
    sourcesFresh: true,
    freshUntil: "2026-08-17T12:00:00.000Z",
  },
  trace: {
    explanationAvailable: true,
    explanationRefCount: 7,
  },
};

const ATTENTION_STATE: FinancialStateView = {
  ...SAFE_STATE,
  contextRevision: `ctx:${"2".repeat(64)}`,
  status: "ATTENTION",
  headline: "Hay algo que EOS está vigilando.",
  detail: "Por ahora no necesitas hacer nada. EOS seguirá observando la situación.",
  money: {
    ...SAFE_STATE.money,
    availableRealMinor: 850000,
  },
  firstForecastRisk: {
    status: "ATTENTION",
    horizonDays: 60,
    until: "2026-10-15T17:30:00.000Z",
    reserveGapMinor: 750000,
    negativeCashGapMinor: 0,
  },
  attention: {
    required: false,
    interrupt: false,
    outcome: "INFORM_NO_ACTION",
    message: "EOS está vigilando un cambio futuro, pero todavía no requiere una decisión.",
  },
};

const ACTION_STATE: FinancialStateView = {
  ...SAFE_STATE,
  contextRevision: `ctx:${"3".repeat(64)}`,
  status: "ACTION_REQUIRED",
  headline: "Necesito una decisión tuya.",
  detail: "Hay una decisión que conviene resolver ahora para mantener protegidos tus compromisos.",
  money: {
    ...SAFE_STATE.money,
    availableRealMinor: 0,
  },
  firstForecastRisk: {
    status: "ACTION_REQUIRED",
    horizonDays: 30,
    until: "2026-09-15T17:30:00.000Z",
    reserveGapMinor: 4700000,
    negativeCashGapMinor: 1700000,
  },
  attention: {
    required: true,
    interrupt: true,
    outcome: "USER_DECISION_REQUIRED",
    message: "Necesito ajustar una decisión antes de continuar para mantener cubiertos tus compromisos y tu reserva.",
  },
};

const DEGRADED_STATE: FinancialStateView = {
  ...SAFE_STATE,
  contextRevision: `ctx:${"4".repeat(64)}`,
  status: "DEGRADED",
  validUntil: null,
  headline: "Necesito actualizar tus datos financieros.",
  detail: "Necesito información financiera actualizada antes de darte una respuesta material.",
  canAssertSafety: false,
  money: {
    ...SAFE_STATE.money,
    availableRealMinor: null,
  },
  firstForecastRisk: null,
  attention: {
    required: true,
    interrupt: true,
    outcome: "CONNECTION_REQUIRED",
    message: "Necesito información financiera actualizada antes de darte una respuesta material.",
  },
  freshness: {
    status: "STALE",
    sourcesFresh: false,
    freshUntil: "2026-08-15T12:00:00.000Z",
  },
};

const STATES = [
  { label: "SAFE · experiencia normal", state: SAFE_STATE },
  { label: "ATTENTION · EOS vigila", state: ATTENTION_STATE },
  { label: "ACTION REQUIRED · una decisión", state: ACTION_STATE },
  { label: "DEGRADED · datos desactualizados", state: DEGRADED_STATE },
];

export default function FinancialStateInternalPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <main className="min-h-screen bg-[#020617] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-400">
            TransTech EOS · Preview interno
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            Financial State
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400 sm:text-base">
            Una vista deliberadamente simple: cuánto es seguro usar, qué ya está protegido y si EOS realmente necesita interrumpir al usuario.
          </p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-2">
          {STATES.map(({ label, state }) => (
            <div key={state.status}>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                {label}
              </p>
              <FinancialStateCard state={state} />
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs leading-5 text-slate-600">
          Esta página usa fixtures y no consulta cuentas, movimientos ni el esquema financiero de producción.
        </p>
      </div>
    </main>
  );
}
