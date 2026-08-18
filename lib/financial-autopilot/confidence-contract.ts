import type { FinancialContextConfidence } from "./types";

export const DEFAULT_SAFE_FINANCIAL_CONFIDENCE_THRESHOLD = 0.8;
export const FINANCIAL_CONFIDENCE_TOLERANCE = 0.000001;

const CONFIDENCE_WEIGHTS = {
  sourceFreshness: 0.3,
  incomePredictability: 0.2,
  expensePredictability: 0.2,
  obligationCompleteness: 0.2,
  reconciliationQuality: 0.1,
} as const;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Canonical Financial Autopilot confidence aggregation. Producer and reader
 * must use this exact contract so a persisted context cannot become SAFE under
 * a different weighting formula than the one that created it.
 */
export function calculateFinancialConfidenceOverall(
  confidence: Omit<FinancialContextConfidence, "overall">,
) {
  return clamp01(
    CONFIDENCE_WEIGHTS.sourceFreshness * confidence.sourceFreshness +
      CONFIDENCE_WEIGHTS.incomePredictability * confidence.incomePredictability +
      CONFIDENCE_WEIGHTS.expensePredictability * confidence.expensePredictability +
      CONFIDENCE_WEIGHTS.obligationCompleteness * confidence.obligationCompleteness +
      CONFIDENCE_WEIGHTS.reconciliationQuality * confidence.reconciliationQuality,
  );
}

export function financialConfidenceOverallMatches(
  confidence: FinancialContextConfidence,
) {
  const expected = calculateFinancialConfidenceOverall(confidence);
  return Math.abs(expected - confidence.overall) <= FINANCIAL_CONFIDENCE_TOLERANCE;
}

export function financialConfidenceSupportsSafe(
  confidence: FinancialContextConfidence,
  threshold = DEFAULT_SAFE_FINANCIAL_CONFIDENCE_THRESHOLD,
) {
  return (
    financialConfidenceOverallMatches(confidence) &&
    confidence.overall >= threshold &&
    confidence.sourceFreshness >= threshold &&
    confidence.obligationCompleteness >= threshold
  );
}
