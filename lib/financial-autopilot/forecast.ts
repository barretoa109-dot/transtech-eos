import type { ForecastEvent } from "./types";

export interface ForecastProjection {
  openingCashMinor: number;
  closingCashMinor: number;
  minimumProjectedCashMinor: number;
  minimumProjectedCashAt: string | null;
  appliedEventIds: string[];
}

export function projectCashflow(
  openingCashMinor: number,
  events: ForecastEvent[],
  untilIso: string,
): ForecastProjection {
  if (!Number.isFinite(openingCashMinor)) {
    throw new Error("openingCashMinor must be finite");
  }

  const until = new Date(untilIso).getTime();
  if (!Number.isFinite(until)) throw new Error("untilIso must be a valid date");

  const ordered = events
    .filter((event) => new Date(event.date).getTime() <= until)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let cash = Math.trunc(openingCashMinor);
  let minimum = cash;
  let minimumAt: string | null = null;
  const appliedEventIds: string[] = [];

  for (const event of ordered) {
    if (!Number.isFinite(event.amountMinor) || event.amountMinor < 0) {
      throw new Error(`invalid forecast amount for ${event.id}`);
    }

    if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1) {
      throw new Error(`invalid forecast confidence for ${event.id}`);
    }

    const probability = event.probability ?? 1;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error(`invalid forecast probability for ${event.id}`);
    }

    // Confidence describes how trustworthy the source/interpretation is; it must not
    // silently shrink the economic amount. Probability is the explicit mechanism for
    // expected-value scenarios. Deterministic events therefore use their full amount.
    const effectiveAmount = Math.trunc(event.amountMinor * probability);
    cash += event.direction === "credit" ? effectiveAmount : -effectiveAmount;
    appliedEventIds.push(event.id);

    if (cash < minimum) {
      minimum = cash;
      minimumAt = event.date;
    }
  }

  return {
    openingCashMinor: Math.trunc(openingCashMinor),
    closingCashMinor: cash,
    minimumProjectedCashMinor: minimum,
    minimumProjectedCashAt: minimumAt,
    appliedEventIds,
  };
}

export function simulateHypotheticalExpense(
  openingCashMinor: number,
  events: ForecastEvent[],
  hypotheticalAmountMinor: number,
  hypotheticalAt: string,
  untilIso: string,
): ForecastProjection {
  const hypothetical: ForecastEvent = {
    id: `hypothetical:${hypotheticalAt}:${hypotheticalAmountMinor}`,
    date: hypotheticalAt,
    type: "expense",
    amountMinor: hypotheticalAmountMinor,
    direction: "debit",
    confidence: 1,
    probability: 1,
    essentiality: "optional",
    sourceRef: "simulation",
  };

  return projectCashflow(openingCashMinor, [...events, hypothetical], untilIso);
}
