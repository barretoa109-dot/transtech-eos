import type { BuiltFinancialContext } from "./context";
import type { NextBestFinancialAction } from "./decision";
import type { ForecastHorizonsResult } from "./forecast-horizons";
import type { FinancialObligation, FinancialStatus } from "./types";

export type FinancialStateDataFreshness = "FRESH" | "STALE" | "UNKNOWN";

export interface FinancialStateCommitmentView {
  type: string;
  amountMinor: number;
  currency: string;
  dueAt: string;
}

export interface FinancialStateRiskView {
  status: "ATTENTION" | "ACTION_REQUIRED";
  horizonDays: number;
  until: string;
  reserveGapMinor: number;
  negativeCashGapMinor: number;
}

export interface FinancialStateAttentionView {
  required: boolean;
  interrupt: boolean;
  outcome: NextBestFinancialAction["outcome"];
  message: string;
}

export interface FinancialStateView {
  version: "financial-state-v1";
  contextRevision: string | null;
  status: FinancialStatus;
  currency: string;
  asOf: string;
  validUntil: string | null;
  headline: string;
  detail: string;
  canAssertSafety: boolean;
  money: {
    availableRealMinor: number | null;
    protectedCommitmentsMinor: number;
    protectedReserveMinor: number;
  };
  nextProtectedCommitment: FinancialStateCommitmentView | null;
  firstForecastRisk: FinancialStateRiskView | null;
  attention: FinancialStateAttentionView;
  freshness: {
    status: FinancialStateDataFreshness;
    sourcesFresh: boolean;
    freshUntil: string | null;
  };
  trace: {
    explanationAvailable: boolean;
    explanationRefCount: number;
  };
}

function dateMs(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function minIso(values: Array<string | null | undefined>) {
  const candidates = values
    .map((value) => ({ value: value ?? null, time: dateMs(value) }))
    .filter(
      (candidate): candidate is { value: string; time: number } =>
        candidate.value !== null && candidate.time !== null,
    )
    .sort((a, b) => a.time - b.time);
  return candidates[0]?.value ?? null;
}

function stateCopy(status: FinancialStatus, action: NextBestFinancialAction) {
  if (status === "DEGRADED") {
    return {
      headline: "Necesito actualizar tus datos financieros.",
      detail: action.message,
    };
  }

  if (status === "ACTION_REQUIRED") {
    return {
      headline: "Necesito una decisión tuya.",
      detail: action.message,
    };
  }

  if (status === "ATTENTION") {
    return {
      headline: "Hay algo que EOS está vigilando.",
      detail: action.interrupt
        ? action.message
        : "Por ahora no necesitas hacer nada. Te avisaré si requiere una decisión.",
    };
  }

  return {
    headline: "Todo está bajo control.",
    detail: action.outcome === "NO_ACTION" ? "No necesitas hacer nada." : action.message,
  };
}

function nextProtectedCommitment(input: {
  obligations: FinancialObligation[];
  currency: string;
  asOf: string;
}): FinancialStateCommitmentView | null {
  const asOfMs = dateMs(input.asOf);
  if (asOfMs === null) throw new Error("financial_state_invalid_as_of");

  const next = input.obligations
    .filter((obligation) => obligation.currency === input.currency)
    .filter((obligation) => obligation.mustProtect)
    .filter((obligation) => obligation.confidence >= 0.75)
    .map((obligation) => ({ obligation, dueMs: dateMs(obligation.dueAt) }))
    .filter(
      (candidate): candidate is { obligation: FinancialObligation; dueMs: number } =>
        candidate.dueMs !== null && candidate.dueMs >= asOfMs,
    )
    .sort((a, b) => a.dueMs - b.dueMs)[0]?.obligation;

  if (!next) return null;

  return {
    type: next.type,
    amountMinor: Math.max(0, Math.trunc(next.amountMinor)),
    currency: next.currency,
    dueAt: next.dueAt,
  };
}

function firstForecastRisk(horizons: ForecastHorizonsResult): FinancialStateRiskView | null {
  if (!horizons.firstRisk) return null;
  return {
    status: horizons.firstRisk.status,
    horizonDays: horizons.firstRisk.days,
    until: horizons.firstRisk.until,
    reserveGapMinor: Math.max(0, Math.trunc(horizons.firstRisk.reserveGapMinor)),
    negativeCashGapMinor: Math.max(0, Math.trunc(horizons.firstRisk.negativeCashGapMinor)),
  };
}

function freshnessState(input: {
  context: BuiltFinancialContext;
  sourceFreshUntil?: string | null;
}): FinancialStateView["freshness"] {
  const freshUntilMs = dateMs(input.sourceFreshUntil);
  const asOfMs = dateMs(input.context.asOf);
  const sourcesFresh = input.context.sourcesFresh;

  if (!sourcesFresh) {
    return {
      status: "STALE",
      sourcesFresh: false,
      freshUntil: input.sourceFreshUntil ?? null,
    };
  }

  if (freshUntilMs === null || asOfMs === null) {
    return {
      status: "UNKNOWN",
      sourcesFresh: true,
      freshUntil: input.sourceFreshUntil ?? null,
    };
  }

  return {
    status: freshUntilMs >= asOfMs ? "FRESH" : "STALE",
    sourcesFresh: freshUntilMs >= asOfMs,
    freshUntil: input.sourceFreshUntil ?? null,
  };
}

export function buildFinancialStateView(input: {
  context: BuiltFinancialContext;
  protectedReserveMinor: number;
  obligations: FinancialObligation[];
  nextAction: NextBestFinancialAction;
  horizons: ForecastHorizonsResult;
  sourceFreshUntil?: string | null;
  contextRevision?: string | null;
}): FinancialStateView {
  const { context, nextAction } = input;
  const copy = stateCopy(context.available.status, nextAction);
  const freshness = freshnessState({
    context,
    sourceFreshUntil: input.sourceFreshUntil,
  });

  const degraded = context.available.status === "DEGRADED" || freshness.status === "STALE";
  const validUntil = degraded
    ? null
    : minIso([context.horizonUntil, input.sourceFreshUntil ?? context.horizonUntil]);
  const required =
    nextAction.outcome === "USER_DECISION_REQUIRED" ||
    nextAction.outcome === "CONNECTION_REQUIRED" ||
    context.available.needsUserAction;

  return {
    version: "financial-state-v1",
    contextRevision: input.contextRevision ?? null,
    status: degraded ? "DEGRADED" : context.available.status,
    currency: context.currency,
    asOf: context.asOf,
    validUntil,
    headline: degraded ? "Necesito actualizar tus datos financieros." : copy.headline,
    detail:
      degraded && nextAction.outcome !== "CONNECTION_REQUIRED"
        ? "Necesito información financiera actualizada antes de decirte cuánto puedes usar con seguridad."
        : copy.detail,
    canAssertSafety: !degraded,
    money: {
      availableRealMinor: degraded ? null : Math.max(0, Math.trunc(context.available.availableRealSafeMinor)),
      protectedCommitmentsMinor: Math.max(0, Math.trunc(context.protectedCommitmentsMinor)),
      protectedReserveMinor: Math.max(0, Math.trunc(input.protectedReserveMinor)),
    },
    nextProtectedCommitment: nextProtectedCommitment({
      obligations: input.obligations,
      currency: context.currency,
      asOf: context.asOf,
    }),
    firstForecastRisk: firstForecastRisk(input.horizons),
    attention: {
      required: degraded ? true : required,
      interrupt: degraded ? true : nextAction.interrupt,
      outcome: degraded ? "CONNECTION_REQUIRED" : nextAction.outcome,
      message: degraded
        ? "Necesito información financiera actualizada antes de darte una respuesta material."
        : nextAction.message,
    },
    freshness,
    trace: {
      explanationAvailable: context.explanationRefs.length > 0,
      explanationRefCount: context.explanationRefs.length,
    },
  };
}
