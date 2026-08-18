import {
  CheckCircle2,
  CircleAlert,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { FinancialSourceOnboardingModel } from "@/lib/financial-autopilot/source-onboarding";

type Props = {
  model: FinancialSourceOnboardingModel;
  preview?: boolean;
};

const STATE_META = {
  CONSENT_REQUIRED: {
    label: "Autorización necesaria",
    icon: LockKeyhole,
    tone: "border-blue-500/25 bg-blue-500/[0.07]",
    badge: "border-blue-400/25 bg-blue-400/10 text-blue-200",
  },
  DISCOVERING: {
    label: "EOS está trabajando",
    icon: LoaderCircle,
    tone: "border-cyan-500/20 bg-cyan-500/[0.06]",
    badge: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
  },
  SOURCE_REQUIRED: {
    label: "Falta una fuente",
    icon: Landmark,
    tone: "border-amber-500/20 bg-amber-500/[0.06]",
    badge: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  },
  REFRESH_REQUIRED: {
    label: "Conexión por actualizar",
    icon: RefreshCw,
    tone: "border-slate-600 bg-slate-900/70",
    badge: "border-slate-500/30 bg-slate-500/10 text-slate-200",
  },
  COVERAGE_READY: {
    label: "Fuentes listas",
    icon: CheckCircle2,
    tone: "border-emerald-500/20 bg-emerald-500/[0.06]",
    badge: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
  },
} satisfies Record<
  FinancialSourceOnboardingModel["state"],
  { label: string; icon: typeof ShieldCheck; tone: string; badge: string }
>;

export default function FinancialSourceOnboardingCard({ model, preview = false }: Props) {
  const meta = STATE_META[model.state];
  const StateIcon = meta.icon;
  const needsAction = model.userAction !== "NOTHING";

  return (
    <section
      className={`overflow-hidden rounded-[2rem] border ${meta.tone}`}
      aria-labelledby="financial-onboarding-title"
    >
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold ${meta.badge}`}>
            <StateIcon
              className={`h-4 w-4 ${model.state === "DISCOVERING" ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {meta.label}
          </span>
          <span className="text-xs font-bold text-slate-400">
            {model.progressPercent}% preparado
          </span>
        </div>

        <div
          className="mt-5 h-2 overflow-hidden rounded-full bg-slate-950/70"
          role="progressbar"
          aria-label="Preparación de fuentes financieras"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={model.progressPercent}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-300 transition-[width]"
            style={{ width: `${model.progressPercent}%` }}
          />
        </div>

        <div className="mt-7 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/50 text-blue-200">
            <StateIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h2 id="financial-onboarding-title" className="text-2xl font-black leading-tight text-white sm:text-3xl">
              {model.headline}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              {model.detail}
            </p>
          </div>
        </div>

        {needsAction ? (
          <div className="mt-7 rounded-3xl border border-white/10 bg-slate-950/55 p-5">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                  EOS necesita de ti
                </p>
                <p className="mt-2 font-bold text-white">Una sola acción</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  EOS seguirá trabajando automáticamente cuando esta fuente quede disponible.
                </p>
                <button
                  type="button"
                  disabled={preview}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-blue-500 px-5 py-3 text-sm font-black text-white transition enabled:hover:bg-blue-400 enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-blue-300 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {preview ? `${model.actionLabel} — disponible tras RC1` : model.actionLabel}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-7 rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                  EOS necesita de ti
                </p>
                <p className="mt-2 text-xl font-black text-white">Nada</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  EOS continuará organizando y verificando la información en segundo plano.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <p className="text-xs leading-5 text-slate-400">
            Acceso de solo lectura. Esta experiencia no recibe credenciales bancarias, no puede mover dinero y no muestra movimientos financieros.
          </p>
        </div>
      </div>
    </section>
  );
}
