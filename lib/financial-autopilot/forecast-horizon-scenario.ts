import { buildForecastHorizons } from "./forecast-horizons";
import type { ForecastEvent } from "./types";

const AS_OF = "2026-08-16T12:00:00.000Z";

function event(
  id: string,
  date: string,
  direction: "credit" | "debit",
  amountMinor: number,
  essentiality: ForecastEvent["essentiality"],
  confidence = 0.99,
  probability = 1,
): ForecastEvent {
  return {
    id,
    date,
    type: direction === "credit" ? "income" : "expense",
    amountMinor,
    direction,
    confidence,
    probability,
    essentiality,
    sourceRef: `scenario:${id}`,
  };
}

export function runForecastHorizonScenario() {
  const healthyEvents: ForecastEvent[] = [
    event("past-expense", "2026-08-01T12:00:00.000Z", "debit", 9000000, "critical"),
    event("rent-aug", "2026-08-26T12:00:00.000Z", "debit", 2000000, "critical"),
    event("salary-sep", "2026-09-01T12:00:00.000Z", "credit", 8000000, "essential", 0.98, 0.98),
    event("essentials-sep", "2026-09-10T12:00:00.000Z", "debit", 1000000, "essential"),
    event("rent-sep", "2026-09-26T12:00:00.000Z", "debit", 2000000, "critical"),
    event("salary-oct", "2026-10-01T12:00:00.000Z", "credit", 8000000, "essential", 0.98, 0.98),
    event("rent-oct", "2026-10-26T12:00:00.000Z", "debit", 2000000, "critical"),
  ];

  const healthy = buildForecastHorizons({
    currency: "PYG",
    asOf: AS_OF,
    openingCashMinor: 6000000,
    protectedReserveMinor: 3000000,
    events: healthyEvents,
  });

  const uncertainIncomeEvents = healthyEvents.map((item) =>
    item.id.startsWith("salary-")
      ? { ...item, confidence: 0.78, probability: 0.75 }
      : item,
  );
  const uncertainIncome = buildForecastHorizons({
    currency: "PYG",
    asOf: AS_OF,
    openingCashMinor: 6000000,
    protectedReserveMinor: 3000000,
    events: uncertainIncomeEvents,
  });

  const immediateConflict = buildForecastHorizons({
    currency: "PYG",
    asOf: AS_OF,
    openingCashMinor: 4000000,
    protectedReserveMinor: 3000000,
    events: [
      event("critical-1", "2026-08-20T12:00:00.000Z", "debit", 3000000, "critical"),
      event("critical-2", "2026-08-22T12:00:00.000Z", "debit", 2000000, "essential"),
      event("uncertain-income", "2026-08-25T12:00:00.000Z", "credit", 9000000, "essential", 0.7, 0.7),
    ],
  });

  const healthy30 = healthy.horizons.find((view) => view.days === 30);
  const uncertain60 = uncertainIncome.horizons.find((view) => view.days === 60);
  const conflict30 = immediateConflict.horizons.find((view) => view.days === 30);

  const checks = {
    defaultHorizonsAre306090:
      healthy.horizons.map((view) => view.days).join(",") === "30,60,90",
    historicalEventIgnored: healthy30?.safe.minimumProjectedCashMinor === 4000000,
    highConfidenceIncomeAdmittedSafely: healthy.firstRisk === null,
    uncertainIncomeNotTrustedForSafeForecast:
      Boolean(uncertain60 && uncertain60.safe.closingCashMinor < uncertain60.expected.closingCashMinor),
    uncertainIncomeCreatesForwardRisk:
      uncertainIncome.firstRisk?.days === 60 && uncertainIncome.firstRisk.status === "ATTENTION",
    immediateCriticalConflictDetected:
      conflict30?.status === "ACTION_REQUIRED" &&
      immediateConflict.firstRisk?.days === 30 &&
      (immediateConflict.firstRisk.negativeCashGapMinor ?? 0) > 0,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    uncertainIncome,
    immediateConflict,
  };
}
