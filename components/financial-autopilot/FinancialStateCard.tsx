import type { FinancialStateView } from "@/lib/financial-autopilot/financial-state";

type FinancialStateCardProps = {
  state: FinancialStateView;
  className?: string;
};

const STATUS_STYLE: Record<
  FinancialStateView["status"],
  { label: string; dot: string; badge: string; panel: string }
> = {
  SAFE: {
    label: "Seguro",
    dot: "bg-emerald-400",
    badge: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    panel: "border-emerald-400/15 bg-emerald-400/[0.06]",
  },
  ATTENTION: {
    label: "En seguimiento",
    dot: "bg-amber-300",
    badge: "border-amber-300/20 bg-amber-300/10 text-amber-200",
    panel: "border-amber-300/15 bg-amber-300/[0.06]",
  },
  ACTION_REQUIRED: {
    label: "Requiere decisión",
    dot: "bg-rose-400",
    badge: "border-rose-400/20 bg-rose-400/10 text-rose-200",
    panel: "border-rose-400/15 bg-rose-400/[0.06]",
  },
  DEGRADED: {
    label: "Datos por actualizar",
    dot: "bg-slate-400",
    badge: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    panel: "border-slate-700 bg-slate-900/70",
  },
};

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === "PYG" ? 0 : 2,
  }).format(Math.trunc(amountMinor));
}

function formatDate(value: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;

  return new Intl.DateTimeFormat("es-PY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(time));
}

function commitmentLabel(type: string) {
  const normalized = type.trim().toLowerCase();
  if (normalized === "housing" || normalized === "rent") return "Vivienda";
  if (normalized === "utility" || normalized === "utilities") return "Servicios";
  if (normalized === "tax") return "Impuestos";
  if (normalized === "debt" || normalized === "loan") return "Deuda";
  if (normalized === "card") return "Tarjeta";
  return type || "Compromiso";
}

function riskMessage(state: FinancialStateView) {
  const risk = state.firstForecastRisk;
  if (!risk) return null;

  if (risk.status === "ACTION_REQUIRED") {
    return `EOS prevé un riesgo material dentro de ${risk.horizonDays} días.`;
  }

  return `EOS está vigilando un posible desajuste dentro de ${risk.horizonDays} días.`;
}

export default function FinancialStateCard({
  state,
  className = "",
}: FinancialStateCardProps) {
  const style = STATUS_STYLE[state.status];
  const available = state.money.availableRealMinor;
  const commitment = state.nextProtectedCommitment;
  const risk = state.firstForecastRisk;
  const riskCopy = riskMessage(state);
  const freshUntil = formatDate(state.freshness.freshUntil);

  return (
    <section
      className={`overflow-hidden rounded-[30px] border border-slate-800 bg-[#071226] shadow-2xl shadow-black/20 ${className}`}
      aria-label="Estado financiero EOS"
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-400">
              Estado financiero
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
              {state.headline}
            </h2>
          </div>

          <div
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${style.badge}`}
          >
            <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
            {style.label}
          </div>
        </div>

        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
          {state.detail}
        </p>

        <div className={`mt-6 rounded-3xl border p-5 sm:p-6 ${style.panel}`}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            {state.canAssertSafety ? "Puedes usar hasta" : "Disponible Real"}
          </p>

          {state.canAssertSafety && available !== null ? (
            <>
              <p className="mt-2 break-words text-4xl font-black tracking-tight text-white sm:text-5xl">
                {formatMoney(available, state.currency)}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Sin comprometer lo que EOS ya protegió.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-4xl font-black tracking-tight text-slate-500 sm:text-5xl">
                —
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                EOS no mostrará una cifra de seguridad hasta tener datos financieros actuales.
              </p>
            </>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Próximo protegido
            </p>

            {commitment ? (
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="font-bold text-white">{commitmentLabel(commitment.type)}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {formatDate(commitment.dueAt) ?? "Próximamente"}
                  </p>
                </div>
                <p className="text-right text-sm font-black text-slate-200">
                  {formatMoney(commitment.amountMinor, commitment.currency)}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-400">
                No hay un compromiso crítico pendiente dentro del horizonte actual.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Próximo riesgo
            </p>

            {risk && riskCopy ? (
              <div className="mt-3">
                <p className="text-sm font-bold leading-6 text-white">{riskCopy}</p>
                {risk.reserveGapMinor > 0 && (
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Cobertura a proteger: {formatMoney(risk.reserveGapMinor, state.currency)}.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-400">
                No se detecta un riesgo material en el horizonte previsto.
              </p>
            )}
          </div>
        </div>

        {state.attention.required && (
          <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-500/[0.08] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-300">
              EOS necesita tu atención
            </p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-200">
              {state.attention.message}
            </p>
          </div>
        )}

        <details className="group mt-5 border-t border-slate-800 pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold text-slate-300 transition hover:text-white">
            <span>Por qué EOS dice esto</span>
            <span className="text-lg text-slate-500 transition group-open:rotate-45" aria-hidden="true">
              +
            </span>
          </summary>

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-950/45 p-4">
              <p className="text-slate-500">Compromisos protegidos</p>
              <p className="mt-1 font-bold text-white">
                {formatMoney(state.money.protectedCommitmentsMinor, state.currency)}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-950/45 p-4">
              <p className="text-slate-500">Reserva protegida</p>
              <p className="mt-1 font-bold text-white">
                {formatMoney(state.money.protectedReserveMinor, state.currency)}
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-500">
            {state.trace.explanationAvailable
              ? `EOS encontró ${state.trace.explanationRefCount} señales suficientes para explicar este estado sin mostrar tus movimientos financieros internos.`
              : "EOS todavía no tiene suficiente evidencia explicativa para ampliar este estado."}
          </p>
        </details>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/35 px-5 py-3 text-xs text-slate-500 sm:px-7">
        <span>
          {state.freshness.status === "FRESH" ? "Datos actualizados" : "Datos por actualizar"}
        </span>
        {freshUntil && state.freshness.status === "FRESH" && (
          <span>Vigente hasta {freshUntil}</span>
        )}
      </footer>
    </section>
  );
}
