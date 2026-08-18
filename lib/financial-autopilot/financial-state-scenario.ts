import { buildFinancialStateView } from "./financial-state";
import { runPyPilotScenario } from "./pilot-scenario";
import type { ForecastHorizonsResult } from "./forecast-horizons";
import type { FinancialObligation } from "./types";

const AS_OF = "2026-08-16T01:00:00.000Z";
const FRESH_UNTIL = "2026-08-17T01:00:00.000Z";
const USER_ID = "00000000-0000-4000-8000-000000000001";

function obligations(): FinancialObligation[] {
  return [
    {
      id: "state-rent",
      userId: USER_ID,
      type: "rent",
      amountMinor: 2100000,
      currency: "PYG",
      dueAt: "2026-08-20T12:00:00.000Z",
      priority: 100,
      mustProtect: true,
      confidence: 0.99,
      source: "state_fixture",
    },
    {
      id: "state-card",
      userId: USER_ID,
      type: "card_balance",
      amountMinor: 2400000,
      currency: "PYG",
      dueAt: "2026-08-25T12:00:00.000Z",
      priority: 100,
      mustProtect: true,
      confidence: 0.99,
      source: "state_fixture",
    },
  ];
}

function healthyHorizons(): ForecastHorizonsResult {
  return {
    asOf: AS_OF,
    currency: "PYG",
    protectedReserveMinor: 3000000,
    horizons: [
      {
        days: 30,
        until: "2026-09-15T01:00:00.000Z",
        status: "SAFE",
        expected: {
          openingCashMinor: 16500000,
          closingCashMinor: 10800000,
          minimumProjectedCashMinor: 10800000,
          minimumProjectedCashAt: "2026-08-30T12:00:00.000Z",
          appliedEventIds: ["forecast-rent", "forecast-card", "forecast-essentials"],
        },
        safe: {
          openingCashMinor: 16500000,
          closingCashMinor: 10800000,
          minimumProjectedCashMinor: 10800000,
          minimumProjectedCashAt: "2026-08-30T12:00:00.000Z",
          appliedEventIds: ["forecast-rent", "forecast-card", "forecast-essentials"],
        },
        reserveGapMinor: 0,
        negativeCashGapMinor: 0,
      },
    ],
    firstRisk: null,
  };
}

function riskHorizons(): ForecastHorizonsResult {
  return {
    ...healthyHorizons(),
    horizons: [
      {
        ...healthyHorizons().horizons[0],
        status: "ACTION_REQUIRED",
        safe: {
          ...healthyHorizons().horizons[0].safe,
          minimumProjectedCashMinor: -1700000,
          minimumProjectedCashAt: "2026-08-30T12:00:00.000Z",
        },
        reserveGapMinor: 4700000,
        negativeCashGapMinor: 1700000,
      },
    ],
    firstRisk: {
      days: 30,
      until: "2026-09-15T01:00:00.000Z",
      status: "ACTION_REQUIRED",
      reserveGapMinor: 4700000,
      negativeCashGapMinor: 1700000,
    },
  };
}

export function runFinancialStateScenario() {
  const pilot = runPyPilotScenario();
  const protectedObligations = obligations();

  const healthy = buildFinancialStateView({
    context: pilot.context,
    protectedReserveMinor: 3000000,
    obligations: protectedObligations,
    nextAction: pilot.nextAction,
    horizons: healthyHorizons(),
    sourceFreshUntil: FRESH_UNTIL,
    contextRevision: "ctx:state-healthy",
  });

  const degraded = buildFinancialStateView({
    context: pilot.degradedContext,
    protectedReserveMinor: 3000000,
    obligations: protectedObligations,
    nextAction: pilot.degradedAction,
    horizons: healthyHorizons(),
    sourceFreshUntil: "2026-08-15T01:00:00.000Z",
    contextRevision: "ctx:state-degraded",
  });

  const actionRequired = buildFinancialStateView({
    context: pilot.actionRequiredContext,
    protectedReserveMinor: 3000000,
    obligations: protectedObligations,
    nextAction: pilot.actionRequiredDecision,
    horizons: riskHorizons(),
    sourceFreshUntil: FRESH_UNTIL,
    contextRevision: "ctx:state-action-required",
  });

  const healthyJson = JSON.stringify(healthy);
  const degradedJson = JSON.stringify(degraded);
  const checks = {
    healthySaysNoAction:
      healthy.status === "SAFE" &&
      healthy.headline === "Todo está bajo control." &&
      healthy.detail === "No necesitas hacer nada." &&
      !healthy.attention.required &&
      !healthy.attention.interrupt,
    availableRealExposedSafely:
      healthy.money.availableRealMinor === 6900000 && healthy.canAssertSafety,
    nextProtectedCommitmentIsRent:
      healthy.nextProtectedCommitment?.type === "rent" &&
      healthy.nextProtectedCommitment.amountMinor === 2100000 &&
      healthy.nextProtectedCommitment.dueAt === "2026-08-20T12:00:00.000Z",
    healthyHasNoForecastRisk: healthy.firstForecastRisk === null,
    degradedNeverExposesSafeAmount:
      degraded.status === "DEGRADED" &&
      degraded.money.availableRealMinor === null &&
      !degraded.canAssertSafety &&
      degraded.attention.required &&
      degraded.attention.outcome === "CONNECTION_REQUIRED",
    staleDataHasNoValidityClaim:
      degraded.freshness.status === "STALE" && degraded.validUntil === null,
    actionRequiredEscalatesOneDecision:
      actionRequired.status === "ACTION_REQUIRED" &&
      actionRequired.attention.required &&
      actionRequired.attention.interrupt &&
      actionRequired.attention.outcome === "USER_DECISION_REQUIRED",
    actionRequiredCarriesFirstRisk:
      actionRequired.firstForecastRisk?.status === "ACTION_REQUIRED" &&
      actionRequired.firstForecastRisk.negativeCashGapMinor === 1700000,
    publicContractDoesNotLeakInternalRefs:
      !healthyJson.includes("explanationRefs") &&
      !healthyJson.includes("ledgerEntries") &&
      !healthyJson.includes("sourceEventId") &&
      !degradedJson.includes("degradedReasons"),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    degraded,
    actionRequired,
  };
}
