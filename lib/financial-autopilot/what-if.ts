import { simulateHypotheticalExpense } from "./forecast";
import type { ForecastEvent } from "./types";

export interface HypotheticalExpenseEvaluationInput {
  openingCashMinor: number;
  currentAvailableRealSafeMinor: number;
  protectedReserveMinor: number;
  forecastEvents: ForecastEvent[];
  amountMinor: number;
  at: string;
  horizonUntil: string;
}

export interface HypotheticalExpenseEvaluation {
  safe: boolean;
  amountMinor: number;
  availableRealAfterMinor: number;
  minimumProjectedCashAfterMinor: number;
  minimumProjectedCashAt: string | null;
  reserveBreachMinor: number;
  reasons: string[];
}

export function evaluateHypotheticalExpense(
  input: HypotheticalExpenseEvaluationInput,
): HypotheticalExpenseEvaluation {
  if (!Number.isFinite(input.amountMinor) || input.amountMinor < 0) {
    throw new Error("amountMinor must be a finite non-negative number");
  }

  const projection = simulateHypotheticalExpense(
    input.openingCashMinor,
    input.forecastEvents,
    input.amountMinor,
    input.at,
    input.horizonUntil,
  );

  const availableRealAfterMinor = Math.max(
    0,
    Math.trunc(input.currentAvailableRealSafeMinor - input.amountMinor),
  );
  const reserveBreachMinor = Math.max(
    0,
    Math.trunc(input.protectedReserveMinor - projection.minimumProjectedCashMinor),
  );

  const reasons: string[] = [];
  if (input.amountMinor > input.currentAvailableRealSafeMinor) {
    reasons.push("exceeds_available_real_safe");
  }
  if (reserveBreachMinor > 0) {
    reasons.push("crosses_protected_reserve");
  }

  return {
    safe: reasons.length === 0,
    amountMinor: Math.trunc(input.amountMinor),
    availableRealAfterMinor,
    minimumProjectedCashAfterMinor: projection.minimumProjectedCashMinor,
    minimumProjectedCashAt: projection.minimumProjectedCashAt,
    reserveBreachMinor,
    reasons,
  };
}
