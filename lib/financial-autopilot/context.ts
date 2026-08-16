import { calculateAvailableReal } from "./available-real";
import { projectCashflow } from "./forecast";
import { calculateUsableLiquidity } from "./liquidity";
import { protectedObligationExplanationRef } from "./protected-obligations-fingerprint";
import type {
  AvailableRealResult,
  FinancialAccount,
  FinancialContextConfidence,
  FinancialObligation,
  ForecastEvent,
} from "./types";

export interface BuildFinancialContextInput {
  currency: string;
  asOf: string;
  horizonUntil: string;
  accounts: FinancialAccount[];
  obligations: FinancialObligation[];
  forecastEvents: ForecastEvent[];
  essentialSpendExpectedMinor: number;
  protectedReserveMinor: number;
  criticalProvisionsMinor: number;
  confirmedIncomeMinor: number;
  uncertaintyBufferMinor: number;
  criticalSourcesComplete: boolean;
  criticalObligationsComplete: boolean;
  confidence: FinancialContextConfidence;
  safeConfidenceThreshold?: number;
}

export interface BuiltFinancialContext {
  currency: string;
  asOf: string;
  horizonUntil: string;
  liquidityUsableMinor: number;
  protectedCommitmentsMinor: number;
  minimumProjectedCashMinor: number;
  minimumProjectedCashAt: string | null;
  sourcesFresh: boolean;
  available: AvailableRealResult;
  explanationRefs: string[];
}

export function buildFinancialContext(input: BuildFinancialContextInput): BuiltFinancialContext {
  const horizon = new Date(input.horizonUntil).getTime();
  if (!Number.isFinite(horizon)) throw new Error("horizonUntil must be a valid date");

  const liquidity = calculateUsableLiquidity(input.accounts, input.currency, input.asOf);

  const protectedObligations = input.obligations.filter((obligation) => {
    const due = new Date(obligation.dueAt).getTime();
    return (
      obligation.currency === input.currency &&
      obligation.mustProtect &&
      obligation.confidence >= 0.75 &&
      Number.isFinite(due) &&
      due <= horizon
    );
  });

  const protectedCommitmentsMinor = protectedObligations.reduce(
    (sum, obligation) => sum + Math.max(0, Math.trunc(obligation.amountMinor)),
    0,
  );

  const forecast = projectCashflow(
    liquidity.usableMinor,
    input.forecastEvents,
    input.horizonUntil,
  );

  const available = calculateAvailableReal({
    currency: input.currency,
    liquidityUsableMinor: liquidity.usableMinor,
    protectedCommitmentsMinor,
    essentialSpendExpectedMinor: input.essentialSpendExpectedMinor,
    protectedReserveMinor: input.protectedReserveMinor,
    criticalProvisionsMinor: input.criticalProvisionsMinor,
    confirmedIncomeMinor: input.confirmedIncomeMinor,
    uncertaintyBufferMinor: input.uncertaintyBufferMinor,
    minimumProjectedCashMinor: forecast.minimumProjectedCashMinor,
    sourcesFresh: liquidity.sourcesFresh,
    criticalSourcesComplete: input.criticalSourcesComplete,
    criticalObligationsComplete: input.criticalObligationsComplete,
    confidence: input.confidence,
    safeConfidenceThreshold: input.safeConfidenceThreshold,
  });

  return {
    currency: input.currency,
    asOf: input.asOf,
    horizonUntil: input.horizonUntil,
    liquidityUsableMinor: liquidity.usableMinor,
    protectedCommitmentsMinor,
    minimumProjectedCashMinor: forecast.minimumProjectedCashMinor,
    minimumProjectedCashAt: forecast.minimumProjectedCashAt,
    sourcesFresh: liquidity.sourcesFresh,
    available,
    explanationRefs: [
      ...liquidity.includedAccountIds.map((id) => `account:${id}`),
      ...protectedObligations.map(protectedObligationExplanationRef),
      ...forecast.appliedEventIds.map((id) => `forecast:${id}`),
    ],
  };
}
