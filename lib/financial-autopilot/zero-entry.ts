import { inferFinancialPatterns, materializePatternForecast } from "./behavior";
import {
  calculateFinancialConfidenceOverall,
} from "./confidence-contract";
import { buildFinancialContext, type BuiltFinancialContext } from "./context";
import { generateFinancialDecisionCandidates } from "./decision-candidates";
import { selectNextBestFinancialAction, type NextBestFinancialAction } from "./decision";
import { buildForecastHorizons, type ForecastHorizonsResult } from "./forecast-horizons";
import {
  confirmedIncomeWithinHorizon,
  estimateVariableEssentialSpend,
  inferObligationsFromPatterns,
  resolvePrimaryFinancialHorizon,
  type EssentialSpendEstimate,
  type PrimaryFinancialHorizon,
} from "./inference";
import { calculateUsableLiquidity } from "./liquidity";
import { findDeterministicReconciliations } from "./reconciliation";
import { detectRecurringPatterns, type DetectedRecurrence } from "./recurrence";
import type {
  FinancialConnectorSnapshot,
  FinancialContextConfidence,
  FinancialObligation,
  ForecastEvent,
  ReconciliationMatch,
} from "./types";

export interface ZeroEntryAutopilotInput {
  snapshot: FinancialConnectorSnapshot;
  currency: string;
  asOf: string;
  protectedReserveMinor: number;
  /** Hard coverage assertion supplied by the trusted source/connection layer. */
  criticalSourcesComplete: boolean;
  criticalObligationsComplete: boolean;
  criticalProvisionsMinor?: number;
  baseUncertaintyBufferMinor?: number;
  fallbackHorizonDays?: number;
}

export interface ZeroEntryResolvedInputs {
  protectedReserveMinor: number;
  criticalProvisionsMinor: number;
  confirmedIncomeMinor: number;
  uncertaintyBufferMinor: number;
  criticalSourcesComplete: boolean;
  criticalObligationsComplete: boolean;
}

export interface ZeroEntryAutopilotResult {
  primaryHorizon: PrimaryFinancialHorizon;
  reconciliation: ReconciliationMatch[];
  recurrences: DetectedRecurrence[];
  patterns: ReturnType<typeof inferFinancialPatterns>;
  obligations: FinancialObligation[];
  essentialSpend: EssentialSpendEstimate;
  forecastEvents: ForecastEvent[];
  confidence: FinancialContextConfidence;
  resolvedInputs: ZeroEntryResolvedInputs;
  context: BuiltFinancialContext;
  nextAction: NextBestFinancialAction;
  horizons: ForecastHorizonsResult;
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("asOf must be valid");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function deriveReconciliationQuality(
  snapshot: FinancialConnectorSnapshot,
  reconciliation: ReconciliationMatch[],
) {
  const posted = snapshot.ledgerEntries.filter((entry) => entry.status === "posted");
  if (posted.length === 0) return 0.7;
  const resolved = new Set(reconciliation.flatMap((match) => match.entryIds));
  const understood = posted.filter(
    (entry) => entry.type !== "unknown" || resolved.has(entry.id),
  ).length;
  return clamp01(understood / posted.length);
}

function deriveConfidence(input: {
  sourceFresh: boolean;
  horizon: PrimaryFinancialHorizon;
  debitPatternCount: number;
  essentialSpendConfidence: number;
  criticalObligationsComplete: boolean;
  reconciliationQuality: number;
}): FinancialContextConfidence {
  const sourceFreshness = input.sourceFresh ? 0.98 : 0.35;
  const incomePredictability =
    input.horizon.reason === "next_high_confidence_income"
      ? input.horizon.confidence
      : 0.55;
  const recurringExpenseScore = Math.min(0.98, 0.65 + input.debitPatternCount * 0.08);
  const expensePredictability = Math.max(
    input.essentialSpendConfidence,
    recurringExpenseScore,
  );
  const obligationCompleteness = input.criticalObligationsComplete ? 0.96 : 0.5;
  const reconciliationQuality = input.reconciliationQuality;
  const overall = calculateFinancialConfidenceOverall({
    sourceFreshness,
    incomePredictability,
    expensePredictability,
    obligationCompleteness,
    reconciliationQuality,
  });

  return {
    sourceFreshness,
    incomePredictability,
    expensePredictability,
    obligationCompleteness,
    reconciliationQuality,
    overall,
  };
}

export function buildZeroEntryFinancialAutopilot(
  input: ZeroEntryAutopilotInput,
): ZeroEntryAutopilotResult {
  if (typeof input.criticalSourcesComplete !== "boolean") {
    throw new Error("criticalSourcesComplete must be boolean");
  }
  if (typeof input.criticalObligationsComplete !== "boolean") {
    throw new Error("criticalObligationsComplete must be boolean");
  }

  const fallbackHorizonDays = input.fallbackHorizonDays ?? 30;
  const reconciliation = findDeterministicReconciliations(input.snapshot.ledgerEntries);
  const recurrences = detectRecurringPatterns(input.snapshot.ledgerEntries);
  const patterns = inferFinancialPatterns(recurrences, input.snapshot.ledgerEntries);
  const primaryHorizon = resolvePrimaryFinancialHorizon(
    patterns,
    input.asOf,
    fallbackHorizonDays,
  );

  const obligations = inferObligationsFromPatterns({
    userId: input.snapshot.accounts[0]?.userId ?? "unknown",
    patterns,
    horizonUntil: primaryHorizon.until,
  });
  const forecastEvents = patterns.flatMap((pattern) =>
    materializePatternForecast(pattern, primaryHorizon.until),
  );
  const essentialSpend = estimateVariableEssentialSpend({
    entries: input.snapshot.ledgerEntries,
    patterns,
    currency: input.currency,
    asOf: input.asOf,
    horizonUntil: primaryHorizon.until,
  });
  const confirmedIncome = confirmedIncomeWithinHorizon({
    patterns,
    asOf: input.asOf,
    horizonUntil: primaryHorizon.until,
    includeAtHorizon: primaryHorizon.reason !== "next_high_confidence_income",
  });
  const liquidity = calculateUsableLiquidity(
    input.snapshot.accounts,
    input.currency,
    input.asOf,
  );
  const reconciliationQuality = deriveReconciliationQuality(input.snapshot, reconciliation);
  const confidence = deriveConfidence({
    sourceFresh: liquidity.sourcesFresh,
    horizon: primaryHorizon,
    debitPatternCount: patterns.filter((pattern) => pattern.direction === "debit").length,
    essentialSpendConfidence: essentialSpend.confidence,
    criticalObligationsComplete: input.criticalObligationsComplete,
    reconciliationQuality,
  });

  const variableSpendUncertainty = Math.round(
    essentialSpend.expectedMinor * (1 - essentialSpend.confidence) * 0.5,
  );
  const fallbackIncomeUncertainty =
    primaryHorizon.reason === "rolling_fallback"
      ? Math.round(liquidity.usableMinor * 0.05)
      : 0;
  const criticalProvisionsMinor = Math.max(
    0,
    Math.trunc(input.criticalProvisionsMinor ?? 0),
  );
  const uncertaintyBufferMinor =
    Math.max(0, Math.trunc(input.baseUncertaintyBufferMinor ?? 0)) +
    variableSpendUncertainty +
    fallbackIncomeUncertainty;

  const resolvedInputs: ZeroEntryResolvedInputs = {
    protectedReserveMinor: Math.max(0, Math.trunc(input.protectedReserveMinor)),
    criticalProvisionsMinor,
    confirmedIncomeMinor: confirmedIncome.amountMinor,
    uncertaintyBufferMinor,
    criticalSourcesComplete: input.criticalSourcesComplete,
    criticalObligationsComplete: input.criticalObligationsComplete,
  };

  const context = buildFinancialContext({
    currency: input.currency,
    asOf: input.asOf,
    horizonUntil: primaryHorizon.until,
    accounts: input.snapshot.accounts,
    obligations,
    forecastEvents,
    essentialSpendExpectedMinor: essentialSpend.expectedMinor,
    protectedReserveMinor: resolvedInputs.protectedReserveMinor,
    criticalProvisionsMinor: resolvedInputs.criticalProvisionsMinor,
    confirmedIncomeMinor: resolvedInputs.confirmedIncomeMinor,
    uncertaintyBufferMinor: resolvedInputs.uncertaintyBufferMinor,
    criticalSourcesComplete: resolvedInputs.criticalSourcesComplete,
    criticalObligationsComplete: resolvedInputs.criticalObligationsComplete,
    confidence,
  });

  const candidates = generateFinancialDecisionCandidates({
    financialContext: context,
    protectedReserveMinor: resolvedInputs.protectedReserveMinor,
  });
  const nextAction = selectNextBestFinancialAction(context.available.status, candidates);

  const horizonUntil90 = addDays(input.asOf, 90);
  const longForecastEvents = patterns.flatMap((pattern) =>
    materializePatternForecast(pattern, horizonUntil90),
  );
  const horizons = buildForecastHorizons({
    currency: input.currency,
    asOf: input.asOf,
    openingCashMinor: liquidity.usableMinor,
    protectedReserveMinor: resolvedInputs.protectedReserveMinor,
    events: longForecastEvents,
  });

  return {
    primaryHorizon,
    reconciliation,
    recurrences,
    patterns,
    obligations,
    essentialSpend,
    forecastEvents,
    confidence,
    resolvedInputs,
    context,
    nextAction,
    horizons,
  };
}
