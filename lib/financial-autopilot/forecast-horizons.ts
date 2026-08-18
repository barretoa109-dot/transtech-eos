import { projectCashflow, type ForecastProjection } from "./forecast";
import type { ForecastEvent } from "./types";

export type ForecastRiskStatus = "SAFE" | "ATTENTION" | "ACTION_REQUIRED";

export interface ForecastHorizonView {
  days: number;
  until: string;
  status: ForecastRiskStatus;
  expected: ForecastProjection;
  safe: ForecastProjection;
  reserveGapMinor: number;
  negativeCashGapMinor: number;
}

export interface ForecastHorizonsResult {
  asOf: string;
  currency: string;
  protectedReserveMinor: number;
  horizons: ForecastHorizonView[];
  firstRisk:
    | {
        days: number;
        until: string;
        status: Exclude<ForecastRiskStatus, "SAFE">;
        reserveGapMinor: number;
        negativeCashGapMinor: number;
      }
    | null;
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("asOf must be a valid date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Builds a conservative event set for safety decisions.
 * - Critical/essential debits are protected at full principal when source confidence is usable.
 * - Credits are only admitted at full principal when both confidence and probability are high.
 * - Flexible/optional debits remain probability-weighted.
 */
export function toSafeForecastEvents(events: ForecastEvent[]): ForecastEvent[] {
  return events.map((event) => {
    const confidence = clamp01(event.confidence);
    const probability = clamp01(event.probability ?? 1);

    if (event.direction === "credit") {
      const admitted = confidence >= 0.9 && probability >= 0.9;
      return { ...event, probability: admitted ? 1 : 0 };
    }

    if (event.essentiality === "critical" || event.essentiality === "essential") {
      return { ...event, probability: confidence >= 0.6 ? 1 : probability };
    }

    return { ...event, probability };
  });
}

function statusForMinimum(minimumCashMinor: number, protectedReserveMinor: number): ForecastRiskStatus {
  if (minimumCashMinor < 0) return "ACTION_REQUIRED";
  if (minimumCashMinor < protectedReserveMinor) return "ATTENTION";
  return "SAFE";
}

export function buildForecastHorizons(input: {
  currency: string;
  asOf: string;
  openingCashMinor: number;
  protectedReserveMinor: number;
  events: ForecastEvent[];
  horizonDays?: number[];
}): ForecastHorizonsResult {
  if (!Number.isFinite(input.openingCashMinor)) throw new Error("openingCashMinor must be finite");
  if (!Number.isFinite(input.protectedReserveMinor) || input.protectedReserveMinor < 0) {
    throw new Error("protectedReserveMinor must be finite and non-negative");
  }

  const asOfMs = new Date(input.asOf).getTime();
  if (!Number.isFinite(asOfMs)) throw new Error("asOf must be a valid date");

  const horizons = [...new Set(input.horizonDays ?? [30, 60, 90])]
    .filter((days) => Number.isInteger(days) && days > 0)
    .sort((a, b) => a - b);

  if (horizons.length === 0) throw new Error("at least one positive horizon is required");

  const futureEvents = input.events.filter((event) => {
    const time = new Date(event.date).getTime();
    return Number.isFinite(time) && time >= asOfMs;
  });
  const safeEvents = toSafeForecastEvents(futureEvents);

  const views: ForecastHorizonView[] = horizons.map((days) => {
    const until = addDays(input.asOf, days);
    const expected = projectCashflow(input.openingCashMinor, futureEvents, until);
    const safe = projectCashflow(input.openingCashMinor, safeEvents, until);
    const reserveGapMinor = Math.max(0, input.protectedReserveMinor - safe.minimumProjectedCashMinor);
    const negativeCashGapMinor = Math.max(0, -safe.minimumProjectedCashMinor);

    return {
      days,
      until,
      status: statusForMinimum(safe.minimumProjectedCashMinor, input.protectedReserveMinor),
      expected,
      safe,
      reserveGapMinor,
      negativeCashGapMinor,
    };
  });

  const firstUnsafe = views.find((view) => view.status !== "SAFE") ?? null;

  return {
    asOf: input.asOf,
    currency: input.currency,
    protectedReserveMinor: Math.trunc(input.protectedReserveMinor),
    horizons: views,
    firstRisk: firstUnsafe
      ? {
          days: firstUnsafe.days,
          until: firstUnsafe.until,
          status: firstUnsafe.status as Exclude<ForecastRiskStatus, "SAFE">,
          reserveGapMinor: firstUnsafe.reserveGapMinor,
          negativeCashGapMinor: firstUnsafe.negativeCashGapMinor,
        }
      : null,
  };
}
