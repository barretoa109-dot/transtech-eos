import { inferFinancialPatterns, materializePatternForecast } from "./behavior";
import {
  calculateFinancialConfidenceOverall,
} from "./confidence-contract";
import { buildFinancialContext, type BuiltFinancialContext } from "./context";
import { generateFinancialDecisionCandidates } from "./decision-candidates";
import { selectNextBestFinancialAction, type NextBestFinancialAction } from "./decision";
import { buildForecastHorizons, type ForecastHorizonsResult } from "./forecast-horizons";
import {
  type TrustedGlobalSourceClosure,
  type TrustedGlobalSourceCoverageResolution,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import { orchestrateTrustedGlobalFinancialSources } from "./global-source-orchestration";
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
import {
  resolveTrustedSourceCoverage,
  type TrustedFinancialSourceInventory,
  type TrustedSourceCoverageResolution,
} from "./source-coverage";
import type {
  FinancialAccount,
  FinancialConnectorSnapshot,
  FinancialContextConfidence,
  FinancialObligation,
  ForecastEvent,
  LedgerEntry,
  ReconciliationMatch,
} from "./types";

export interface ZeroEntryAutopilotInput {
  /** Server-derived owner. Snapshot/inventory ownership must match this value. */
  trustedUserId: string;
  snapshot: FinancialConnectorSnapshot;
  sourceCoverageInventory: TrustedFinancialSourceInventory;
  currency: string;
  asOf: string;
  protectedReserveMinor: number;
  criticalObligationsComplete: boolean;
  criticalProvisionsMinor?: number;
  baseUncertaintyBufferMinor?: number;
  fallbackHorizonDays?: number;
}

export interface GlobalZeroEntryAutopilotInput {
  /** Server-derived owner. Every provider bundle and the closure must match it. */
  trustedUserId: string;
  bundles: TrustedScopedSourceBundle[];
  globalSourceClosure: TrustedGlobalSourceClosure;
  currency: string;
  asOf: string;
  protectedReserveMinor: number;
  criticalObligationsComplete: boolean;
  criticalProvisionsMinor?: number;
  baseUncertaintyBufferMinor?: number;
  fallbackHorizonDays?: number;
}

export type ZeroEntrySourceCoverageResolution =
  | TrustedSourceCoverageResolution
  | TrustedGlobalSourceCoverageResolution;

export type ZeroEntryAnalysisScope = "single_provider" | "multi_provider";

export interface ZeroEntryResolvedInputs {
  protectedReserveMinor: number;
  criticalProvisionsMinor: number;
  confirmedIncomeMinor: number;
  uncertaintyBufferMinor: number;
  criticalSourcesComplete: boolean;
  criticalSourcesFresh: boolean;
  sourceCoverageFingerprint: string | null;
  sourceCoverageValidUntil: string | null;
  criticalObligationsComplete: boolean;
}

export interface ZeroEntryAutopilotResult {
  /** Optional for backwards-compatible callers; builders in this module always set it. */
  analysisScope?: ZeroEntryAnalysisScope;
  /** Multi-provider binding. Single-provider analysis always returns null. */
  sourceOrchestrationFingerprint?: string | null;
  primaryHorizon: PrimaryFinancialHorizon;
  reconciliation: ReconciliationMatch[];
  recurrences: DetectedRecurrence[];
  patterns: ReturnType<typeof inferFinancialPatterns>;
  obligations: FinancialObligation[];
  essentialSpend: EssentialSpendEstimate;
  forecastEvents: ForecastEvent[];
  confidence: FinancialContextConfidence;
  sourceCoverage: ZeroEntrySourceCoverageResolution;
  resolvedInputs: ZeroEntryResolvedInputs;
  context: BuiltFinancialContext;
  nextAction: NextBestFinancialAction;
  horizons: ForecastHorizonsResult;
}

export interface SingleProviderZeroEntryAutopilotResult
  extends ZeroEntryAutopilotResult {
  analysisScope: "single_provider";
  sourceOrchestrationFingerprint: null;
  sourceCoverage: TrustedSourceCoverageResolution;
}

export interface GlobalZeroEntryAutopilotResult extends ZeroEntryAutopilotResult {
  analysisScope: "multi_provider";
  sourceOrchestrationFingerprint: string | null;
  sourceCoverage: TrustedGlobalSourceCoverageResolution;
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

function assertTrustedAnalysisOwner(input: {
  accounts: FinancialAccount[];
  ledgerEntries: LedgerEntry[];
  trustedUserId: string;
}) {
  if (!input.trustedUserId) {
    throw new Error("financial_autopilot_missing_trusted_user");
  }
  if (
    input.accounts.some((account) => account.userId !== input.trustedUserId) ||
    input.ledgerEntries.some((entry) => entry.userId !== input.trustedUserId)
  ) {
    throw new Error("financial_autopilot_snapshot_user_mismatch");
  }
}

function assertLedgerAccountReferences(input: {
  accounts: FinancialAccount[];
  ledgerEntries: LedgerEntry[];
}) {
  const accountIds = new Set(input.accounts.map((account) => account.id));
  if (input.ledgerEntries.some((entry) => !accountIds.has(entry.accountId))) {
    throw new Error("financial_autopilot_ledger_account_scope_mismatch");
  }
}

function deriveReconciliationQuality(
  ledgerEntries: LedgerEntry[],
  reconciliation: ReconciliationMatch[],
) {
  const posted = ledgerEntries.filter((entry) => entry.status === "posted");
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

interface ZeroEntryResolvedAnalysisInput {
  trustedUserId: string;
  accounts: FinancialAccount[];
  ledgerEntries: LedgerEntry[];
  sourceCoverage: ZeroEntrySourceCoverageResolution;
  analysisScope: ZeroEntryAnalysisScope;
  sourceOrchestrationFingerprint: string | null;
  currency: string;
  asOf: string;
  protectedReserveMinor: number;
  criticalObligationsComplete: boolean;
  criticalProvisionsMinor?: number;
  baseUncertaintyBufferMinor?: number;
  fallbackHorizonDays?: number;
}

function buildZeroEntryFromResolvedAnalysis(
  input: ZeroEntryResolvedAnalysisInput,
): ZeroEntryAutopilotResult {
  assertTrustedAnalysisOwner(input);
  assertLedgerAccountReferences(input);
  if (typeof input.criticalObligationsComplete !== "boolean") {
    throw new Error("criticalObligationsComplete must be boolean");
  }

  const fallbackHorizonDays = input.fallbackHorizonDays ?? 30;
  const reconciliation = findDeterministicReconciliations(input.ledgerEntries);
  const recurrences = detectRecurringPatterns(input.ledgerEntries);
  const patterns = inferFinancialPatterns(recurrences, input.ledgerEntries);
  const primaryHorizon = resolvePrimaryFinancialHorizon(
    patterns,
    input.asOf,
    fallbackHorizonDays,
  );

  const obligations = inferObligationsFromPatterns({
    userId: input.trustedUserId,
    patterns,
    horizonUntil: primaryHorizon.until,
  });
  const forecastEvents = patterns.flatMap((pattern) =>
    materializePatternForecast(pattern, primaryHorizon.until),
  );
  const essentialSpend = estimateVariableEssentialSpend({
    entries: input.ledgerEntries,
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
    input.accounts,
    input.currency,
    input.asOf,
  );
  const allCriticalSourcesFresh =
    liquidity.sourcesFresh && input.sourceCoverage.criticalSourcesFresh;
  const reconciliationQuality = deriveReconciliationQuality(
    input.ledgerEntries,
    reconciliation,
  );
  const confidence = deriveConfidence({
    sourceFresh: allCriticalSourcesFresh,
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
    criticalSourcesComplete: input.sourceCoverage.criticalSourcesComplete,
    criticalSourcesFresh: input.sourceCoverage.criticalSourcesFresh,
    sourceCoverageFingerprint: input.sourceCoverage.inventoryFingerprint,
    sourceCoverageValidUntil: input.sourceCoverage.coverageValidUntil,
    criticalObligationsComplete: input.criticalObligationsComplete,
  };

  const context = buildFinancialContext({
    currency: input.currency,
    asOf: input.asOf,
    horizonUntil: primaryHorizon.until,
    accounts: input.accounts,
    obligations,
    forecastEvents,
    essentialSpendExpectedMinor: essentialSpend.expectedMinor,
    protectedReserveMinor: resolvedInputs.protectedReserveMinor,
    criticalProvisionsMinor: resolvedInputs.criticalProvisionsMinor,
    confirmedIncomeMinor: resolvedInputs.confirmedIncomeMinor,
    uncertaintyBufferMinor: resolvedInputs.uncertaintyBufferMinor,
    criticalSourcesFresh: resolvedInputs.criticalSourcesFresh,
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
    analysisScope: input.analysisScope,
    sourceOrchestrationFingerprint: input.sourceOrchestrationFingerprint,
    primaryHorizon,
    reconciliation,
    recurrences,
    patterns,
    obligations,
    essentialSpend,
    forecastEvents,
    confidence,
    sourceCoverage: input.sourceCoverage,
    resolvedInputs,
    context,
    nextAction,
    horizons,
  };
}

export function buildZeroEntryFinancialAutopilot(
  input: ZeroEntryAutopilotInput,
): SingleProviderZeroEntryAutopilotResult {
  assertTrustedAnalysisOwner({
    accounts: input.snapshot.accounts,
    ledgerEntries: input.snapshot.ledgerEntries,
    trustedUserId: input.trustedUserId,
  });
  const sourceCoverage = resolveTrustedSourceCoverage({
    trustedUserId: input.trustedUserId,
    snapshot: input.snapshot,
    inventory: input.sourceCoverageInventory,
    nowIso: input.asOf,
  });

  const result = buildZeroEntryFromResolvedAnalysis({
    trustedUserId: input.trustedUserId,
    accounts: input.snapshot.accounts,
    ledgerEntries: input.snapshot.ledgerEntries,
    sourceCoverage,
    analysisScope: "single_provider",
    sourceOrchestrationFingerprint: null,
    currency: input.currency,
    asOf: input.asOf,
    protectedReserveMinor: input.protectedReserveMinor,
    criticalObligationsComplete: input.criticalObligationsComplete,
    criticalProvisionsMinor: input.criticalProvisionsMinor,
    baseUncertaintyBufferMinor: input.baseUncertaintyBufferMinor,
    fallbackHorizonDays: input.fallbackHorizonDays,
  });

  return {
    ...result,
    analysisScope: "single_provider",
    sourceOrchestrationFingerprint: null,
    sourceCoverage,
  };
}

/**
 * Multi-provider Zero Entry analysis. Coverage and analysis are derived from the
 * same provider bundles through the global orchestration contract. Persistence
 * must remain provider-scoped; the existing single-provider persistence builder
 * explicitly rejects this result type.
 */
export function buildZeroEntryFinancialAutopilotFromGlobalSources(
  input: GlobalZeroEntryAutopilotInput,
): GlobalZeroEntryAutopilotResult {
  const orchestration = orchestrateTrustedGlobalFinancialSources({
    trustedUserId: input.trustedUserId,
    bundles: input.bundles,
    closure: input.globalSourceClosure,
    nowIso: input.asOf,
  });

  const result = buildZeroEntryFromResolvedAnalysis({
    trustedUserId: input.trustedUserId,
    accounts: orchestration.analysis.accounts,
    ledgerEntries: orchestration.analysis.ledgerEntries,
    sourceCoverage: orchestration.coverage,
    analysisScope: "multi_provider",
    sourceOrchestrationFingerprint: orchestration.orchestrationFingerprint,
    currency: input.currency,
    asOf: input.asOf,
    protectedReserveMinor: input.protectedReserveMinor,
    criticalObligationsComplete: input.criticalObligationsComplete,
    criticalProvisionsMinor: input.criticalProvisionsMinor,
    baseUncertaintyBufferMinor: input.baseUncertaintyBufferMinor,
    fallbackHorizonDays: input.fallbackHorizonDays,
  });

  return {
    ...result,
    analysisScope: "multi_provider",
    sourceOrchestrationFingerprint: orchestration.orchestrationFingerprint,
    sourceCoverage: orchestration.coverage,
  };
}
