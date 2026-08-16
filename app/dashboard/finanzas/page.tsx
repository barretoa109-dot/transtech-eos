import { notFound } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { FinancialStateView } from "@/lib/financial-autopilot/financial-state";
import {
  isFinancialStateApiEnabled,
  resolveFinancialState,
  SupabaseFinancialStateReaderV1_1,
} from "@/lib/financial-autopilot/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEMO_REVISION = `ctx:${"d".repeat(64)}`;

function demoState(kind: string | undefined): FinancialStateView {
  const common: Omit<
    FinancialStateView,
    | "status"
    | "headline"
    | "detail"
    | "canAssertSafety"
    | "money"
    | "firstForecastRisk"
    | "attention"
    | "freshness"
  > = {
    version: "financial-state-v1",
    contextRevision: DEMO_REVISION,
    currency: "PYG",
    asOf: "2026-08-16T16:30:00.000-03:00",
    validUntil: "2026-08-17T16:30:00.000-03:00",
    nextProtectedCommitment: {
      type: "Alquiler",
      amountMinor: 2100000,
      currency: "PYG",
      dueAt: "2026-08-25T12:00:00.000-03:00",
    },
    trace: {
      explanationAvailable: true,
      explanationRefCount: 8,
    },
  };

  if (kind === "degraded") {
    return {
      ...common,
      status: "DEGRADED",
      validUntil: null,
      headline: "Necesito actualizar tus datos financieros.",
      detail:
        "No voy a decirte cuánto puedes usar hasta comprobar que la información esté al día.",
      canAssertSafety: false,
      money: {
        availableRealMinor: null,
        protectedCommitmentsMinor: 2100000,
        protectedReserveMinor: 3000000,
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
        freshUntil: "2026-08-16T12:00:00.000-03:00",
      },
    };
  }

  if (kind === "action") {
    return {
      ...common,
      status: "ACTION_REQUIRED",
      headline: "Necesito una decisión tuya.",
      detail: "Si mantienes este ritmo, tu reserva protegida quedará comprometida dentro de 60 días.",
      canAssertSafety: true,
      money: {
        availableRealMinor: 640000,
        protectedCommitmentsMinor: 2100000,
        protectedReserveMinor: 3000000,
      },
      firstForecastRisk: {
        status: "ACTION_REQUIRED",
        horizonDays: 60,
        until: "2026-10-15T12:00:00.000-03:00",
        reserveGapMinor: 1750000,
        negativeCashGapMinor: 0,
      },
      attention: {
        required: true,
        interrupt: true,
        outcome: "USER_DECISION_REQUIRED",
        message: "Necesito que elijas si prefieres reducir gasto flexible o proteger más caja.",
      },
      freshness: {
        status: "FRESH",
        sourcesFresh: true,
        freshUntil: "2026-08-17T16:30:00.000-03:00",
      },
    };
  }

  if (kind === "attention") {
    return {
      ...common,
      status: "ATTENTION",
      headline: "Hay algo que EOS está vigilando.",
      detail: "Por ahora no necesitas hacer nada. Te avisaré si requiere una decisión.",
      canAssertSafety: true,
      money: {
        availableRealMinor: 1640000,
        protectedCommitmentsMinor: 2100000,
        protectedReserveMinor: 3000000,
      },
      firstForecastRisk: {
        status: "ATTENTION",
        horizonDays: 60,
        until: "2026-10-15T12:00:00.000-03:00",
        reserveGapMinor: 750000,
        negativeCashGapMinor: 0,
      },
      attention: {
        required: false,
        interrupt: false,
        outcome: "INFORM_NO_ACTION",
        message: "EOS está vigilando la reserva a 60 días.",
      },
      freshness: {
        status: "FRESH",
        sourcesFresh: true,
        freshUntil: "2026-08-17T16:30:00.000-03:00",
      },
    };
  }

  return {
    ...common,
    status: "SAFE",
    headline: "Todo está bajo control.",
    detail: "No necesitas hacer nada.",
    canAssertSafety: true,
    money: {
      availableRealMinor: 1640000,
      protectedCommitmentsMinor: 2100000,
      protectedReserveMinor: 3000000,
    },
    firstForecastRisk: null,
    attention: {
      required: false,
      interrupt: false,
      outcome: "NO_ACTION",
      message: "No necesitas hacer nada.",
    },
    freshness: {
      status: "FRESH",
      sourcesFresh: true,
      freshUntil: "2026-08-17T16:30:00.000-03:00",
    },
  };
}

function formatMoney(amountMinor: number | null, currency: string) {
  if (amountMinor === null) return "—";
  if (currency === "PYG") {
    return `₲ ${new Intl.NumberFormat("es-PY", {
      maximumFractionDigits: 0,
    }).format(amountMinor)}`;
  }

  const zeroDecimal = new Set(["JPY", "KRW", "CLP"]);
  const exponent = zeroDecimal.has(currency) ? 0 : 2;
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency,
    maximumFractionDigits: exponent,
  }).format(amountMinor / 10 ** exponent);
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(
    "es-PY",
    withTime
      ? {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }
      : { day: "2-digit", month: "short" },
  ).format(date);
}

function statusMeta(status: FinancialStateView["status"]) {
  if (status === "DEGRADED") {
    return {
      label: "Datos desactualizados",
      pill: "border-slate-600 bg-slate-800 text-slate-200",
      panel: "border-slate-700 bg-slate-900/70",
      icon: RefreshCw,
    };
  }
  if (status === "ACTION_REQUIRED") {
    return {
      label: "Decisión necesaria",
      pill: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      panel: "border-rose-500/20 bg-rose-500/[0.06]",
      icon: CircleAlert,
    };
  }
  if (status === "ATTENTION") {
    return {
      label: "En vigilancia",
      pill: "border-amber-500/30 bg-amber-500/10 text-amber-100",
      panel: "border-amber-500/20 bg-amber-500/[0.05]",
      icon: Clock3,
    };
  }
  return {
    label: "Seguro",
    pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    panel: "border-emerald-500/20 bg-emerald-500/[0.05]",
    icon: ShieldCheck,
  };
}

async function resolveLiveState(): Promise<FinancialStateView | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const reader = new SupabaseFinancialStateReaderV1_1(supabase, user.id);
  const resolution = await resolveFinancialState({
    trustedUserId: user.id,
    reader,
    nowIso: new Date().toISOString(),
  });

  return resolution.kind === "STATE" ? resolution.state : null;
}

export default async function FinancialStatePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  const isProduction = process.env.VERCEL_ENV === "production";
  const apiEnabled = isFinancialStateApiEnabled();
  const demoAllowed = !isProduction;
  const requestedDemo = demoAllowed ? params.demo : undefined;

  if (isProduction && !apiEnabled) notFound();

  let state: FinancialStateView | null = null;
  let source: "live" | "demo" = "demo";

  if (apiEnabled && !requestedDemo) {
    try {
      state = await resolveLiveState();
      source = "live";
    } catch {
      state = null;
    }
  }

  if (!state && demoAllowed) {
    state = demoState(requestedDemo);
    source = "demo";
  }

  if (!state) notFound();

  const meta = statusMeta(state.status);
  const StatusIcon = meta.icon;
  const available = state.money.availableRealMinor;
  const commitment = state.nextProtectedCommitment;
  const risk = state.firstForecastRisk;
  const freshUntil = formatDate(state.freshness.freshUntil, true);
  const asOf = formatDate(state.asOf, true);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
              EOS Finanzas
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
              Tu estado financiero
            </h1>
          </div>
          {source === "demo" ? (
            <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-200">
              Preview
            </span>
          ) : null}
        </header>

        <section className={`overflow-hidden rounded-[2rem] border ${meta.panel}`}>
          <div className="p-5 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold ${meta.pill}`}
              >
                <StatusIcon className="h-4 w-4" aria-hidden="true" />
                {meta.label}
              </span>
              {asOf ? (
                <span className="text-xs font-medium text-slate-500">Actualizado {asOf}</span>
              ) : null}
            </div>

            <div className="mt-7">
              <h2 className="max-w-2xl text-2xl font-black leading-tight text-white sm:text-4xl">
                {state.headline}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                {state.detail}
              </p>
            </div>

            <div className="mt-8 rounded-3xl border border-white/10 bg-slate-950/60 p-5 sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
                Disponible Real
              </p>
              {state.canAssertSafety && available !== null ? (
                <>
                  <p className="mt-2 text-sm font-semibold text-slate-300">Puedes usar hasta</p>
                  <p className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
                    {formatMoney(available, state.currency)}
                  </p>
                  <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-200">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {state.attention.required ? state.attention.message : "No necesitas hacer nada."}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-3xl font-black tracking-tight text-white">
                    Pendiente de actualización
                  </p>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                    EOS no mostrará un monto seguro mientras los datos no sean suficientemente confiables.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-200">
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">
                  Próximo compromiso
                </p>
                <p className="mt-1 font-bold text-white">
                  {commitment?.type ?? "Nada crítico próximo"}
                </p>
              </div>
            </div>

            {commitment ? (
              <div className="mt-5 flex items-end justify-between gap-4">
                <p className="text-2xl font-black text-white">
                  {formatMoney(commitment.amountMinor, commitment.currency)}
                </p>
                <p className="text-sm font-semibold text-slate-400">
                  {formatDate(commitment.dueAt) ?? "Fecha pendiente"}
                </p>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-slate-400">
                EOS no detecta un compromiso protegido dentro del horizonte actual.
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800 text-slate-200">
                {risk ? (
                  <CircleAlert className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">
                  Mirando hacia adelante
                </p>
                <p className="mt-1 font-bold text-white">
                  {risk ? `EOS vigila un riesgo a ${risk.horizonDays} días` : "Sin riesgo material detectado"}
                </p>
              </div>
            </div>

            {risk ? (
              <div className="mt-5 space-y-2 text-sm leading-6 text-slate-400">
                {risk.reserveGapMinor > 0 ? (
                  <p>
                    Faltarían {formatMoney(risk.reserveGapMinor, state.currency)} para conservar íntegra tu reserva protegida.
                  </p>
                ) : null}
                {risk.negativeCashGapMinor > 0 ? (
                  <p>
                    El escenario proyecta un faltante de {formatMoney(risk.negativeCashGapMinor, state.currency)}.
                  </p>
                ) : null}
                <p className="font-semibold text-slate-300">
                  Horizonte: {formatDate(risk.until) ?? `${risk.horizonDays} días`}.
                </p>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-slate-400">
                Con la información actual, EOS no detecta una decisión financiera que deba interrumpirte.
              </p>
            )}
          </section>
        </div>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/45 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Clock3 className="h-5 w-5 text-slate-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-white">
                {state.freshness.status === "FRESH" ? "Datos al día" : "Datos que necesitan actualización"}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {freshUntil
                  ? `Confiables hasta ${freshUntil}.`
                  : "EOS no tiene una ventana de frescura suficiente para afirmar seguridad."}
              </p>
            </div>
          </div>
        </section>

        <details className="group rounded-3xl border border-slate-800 bg-slate-900/35">
          <summary className="cursor-pointer list-none px-5 py-5 font-bold text-white sm:px-6">
            <span className="flex items-center justify-between gap-4">
              <span>Por qué EOS dice esto</span>
              <span className="text-xs font-semibold text-slate-500 group-open:hidden">Ver detalle</span>
              <span className="hidden text-xs font-semibold text-slate-500 group-open:inline">Ocultar</span>
            </span>
          </summary>
          <div className="border-t border-slate-800 px-5 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-950/60 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Compromisos protegidos
                </p>
                <p className="mt-2 text-xl font-black text-white">
                  {formatMoney(state.money.protectedCommitmentsMinor, state.currency)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-950/60 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Reserva protegida
                </p>
                <p className="mt-2 text-xl font-black text-white">
                  {formatMoney(state.money.protectedReserveMinor, state.currency)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm leading-6 text-slate-400">
              <p>
                EOS usa únicamente señales financieras normalizadas para construir este estado. No expone movimientos del Ledger ni evidencia interna en esta pantalla.
              </p>
              {state.trace.explanationAvailable ? (
                <p className="mt-2">
                  Hay {state.trace.explanationRefCount} señales de explicación disponibles para auditoría interna.
                </p>
              ) : null}
            </div>
          </div>
        </details>

        {demoAllowed ? (
          <p className="px-2 pb-4 text-center text-xs leading-5 text-slate-600">
            Preview post-RC1. Prueba <span className="text-slate-500">?demo=safe</span>,{" "}
            <span className="text-slate-500">attention</span>,{" "}
            <span className="text-slate-500">action</span> o{" "}
            <span className="text-slate-500">degraded</span>. En producción la ruta permanece oculta mientras el feature flag esté apagado.
          </p>
        ) : null}
      </div>
    </div>
  );
}
