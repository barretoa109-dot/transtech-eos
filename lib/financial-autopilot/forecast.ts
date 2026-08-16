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

    const effectiveAmount = Math.trunc(event.amountMinor * Math.max(0, Math.min(1, event.confidence)));
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
    essentiality: "optional",
    sourceRef: "simulation",
  };

  return projectCashflow(openingCashMinor, [...events, hypothetical], untilIso);
}
