import type { FinancialStateView } from "./financial-state";
import { buildFinancialSurfaceModel } from "./financial-surface";

const REVISION = `ctx:${"a".repeat(64)}`;

function safeState(): FinancialStateView {
  return {
    version: "financial-state-v1",
    contextRevision: REVISION,
    status: "SAFE",
    currency: "PYG",
    asOf: "2026-08-16T16:30:00.000-03:00",
    validUntil: "2026-08-17T16:30:00.000-03:00",
    headline: "Todo está bajo control.",
    detail: "No necesitas hacer nada.",
    canAssertSafety: true,
    money: {
      availableRealMinor: 1640000,
      protectedCommitmentsMinor: 2100000,
      protectedReserveMinor: 3000000,
    },
    nextProtectedCommitment: {
      type: "rent",
      amountMinor: 2100000,
      currency: "PYG",
      dueAt: "2026-08-25T12:00:00.000-03:00",
    },
    firstForecastRisk: null,
    attention: {
      required: false,
      interrupt: false,
      outcome: "NO_ACTION",
      message: "No necesitas hacer nada.",
    },
    freshness: {
      status: "FRESH",
      sourcesFresh: true,
      freshUntil: "2026-08-17T16:30:00.000-03:00",
    },
    trace: {
      explanationAvailable: true,
      explanationRefCount: 8,
    },
  };
}

export function runFinancialSurfaceScenario() {
  const safe = buildFinancialSurfaceModel({ kind: "STATE", state: safeState() });

  const attention = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      status: "ATTENTION",
      headline: "Hay algo que EOS está vigilando.",
      detail: "Por ahora no necesitas hacer nada.",
      firstForecastRisk: {
        status: "ATTENTION",
        horizonDays: 60,
        until: "2026-10-15T12:00:00.000-03:00",
        reserveGapMinor: 750000,
        negativeCashGapMinor: 0,
      },
      attention: {
        required: false,
        interrupt: false,
        outcome: "INFORM_NO_ACTION",
        message: "EOS está vigilando la reserva a 60 días.",
      },
    },
  });

  const action = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      status: "ACTION_REQUIRED",
      headline: "Necesito una decisión tuya.",
      detail: "Tu reserva protegida requiere una decisión.",
      money: {
        ...safeState().money,
        availableRealMinor: 640000,
      },
      firstForecastRisk: {
        status: "ACTION_REQUIRED",
        horizonDays: 60,
        until: "2026-10-15T12:00:00.000-03:00",
        reserveGapMinor: 1750000,
        negativeCashGapMinor: 0,
      },
      attention: {
        required: true,
        interrupt: true,
        outcome: "USER_DECISION_REQUIRED",
        message: "Necesito una decisión tuya.",
      },
    },
  });

  const degraded = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      status: "DEGRADED",
      headline: "Necesito actualizar tus datos financieros.",
      detail: "La lectura ya no es suficientemente reciente.",
      canAssertSafety: false,
      validUntil: null,
      money: {
        ...safeState().money,
        availableRealMinor: null,
      },
      freshness: {
        status: "STALE",
        sourcesFresh: false,
        freshUntil: "2026-08-16T12:00:00.000-03:00",
      },
      attention: {
        required: true,
        interrupt: true,
        outcome: "CONNECTION_REQUIRED",
        message: "Necesito actualizar tus datos financieros.",
      },
    },
  });

  const inconsistentStale = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      canAssertSafety: true,
      money: {
        ...safeState().money,
        availableRealMinor: 999999999,
      },
      freshness: {
        status: "STALE",
        sourcesFresh: false,
        freshUntil: "2026-08-15T12:00:00.000-03:00",
      },
    },
  });

  const unknownFreshness = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      freshness: {
        status: "UNKNOWN",
        sourcesFresh: true,
        freshUntil: null,
      },
    },
  });

  const invalidAvailable = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      money: {
        ...safeState().money,
        availableRealMinor: -1,
      },
    },
  });

  const invalidCurrency = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      currency: "pyg",
    },
  });

  const invalidAggregates = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      money: {
        ...safeState().money,
        protectedReserveMinor: -1,
      },
    },
  });

  const invalidCommitment = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      nextProtectedCommitment: {
        ...safeState().nextProtectedCommitment!,
        amountMinor: -1,
      },
    },
  });

  const invalidRisk = buildFinancialSurfaceModel({
    kind: "STATE",
    state: {
      ...safeState(),
      firstForecastRisk: {
        status: "ATTENTION",
        horizonDays: 60,
        until: "2026-10-15T12:00:00.000-03:00",
        reserveGapMinor: -1,
        negativeCashGapMinor: 0,
      },
    },
  });

  const noData = buildFinancialSurfaceModel({ kind: "NO_DATA" });
  const error = buildFinancialSurfaceModel({ kind: "ERROR" });
  const publicJson = JSON.stringify({ safe, attention, action, degraded, noData, error });

  const checks = {
    safeShowsExactAvailableReal:
      safe.status === "SAFE" &&
      safe.statusLabel === "Seguro" &&
      safe.availableReal.visible &&
      safe.availableReal.amountMinor === 1640000 &&
      safe.availableReal.supportingText === "No necesitas hacer nada.",
    attentionKeepsUserUninterrupted:
      attention.status === "ATTENTION" &&
      attention.statusLabel === "En vigilancia" &&
      attention.availableReal.visible &&
      !attention.attention.required &&
      attention.firstForecastRisk?.horizonDays === 60,
    actionSurfacesOneDecision:
      action.status === "ACTION_REQUIRED" &&
      action.statusLabel === "Decisión necesaria" &&
      action.availableReal.amountMinor === 640000 &&
      action.attention.required &&
      action.attention.interrupt,
    degradedNeverShowsAvailableRealOrProjection:
      degraded.status === "DEGRADED" &&
      !degraded.availableReal.visible &&
      degraded.availableReal.amountMinor === null &&
      degraded.validUntil === null &&
      degraded.nextProtectedCommitment === null &&
      degraded.firstForecastRisk === null &&
      degraded.why === null,
    staleInconsistencyFailsClosed:
      !inconsistentStale.availableReal.visible &&
      inconsistentStale.availableReal.amountMinor === null &&
      inconsistentStale.nextProtectedCommitment === null &&
      inconsistentStale.why === null,
    unknownFreshnessFailsClosed:
      !unknownFreshness.availableReal.visible &&
      unknownFreshness.availableReal.amountMinor === null,
    invalidMoneyFailsClosed:
      !invalidAvailable.availableReal.visible &&
      invalidAvailable.availableReal.amountMinor === null,
    invalidCurrencyFailsClosed:
      invalidCurrency.currency === null &&
      !invalidCurrency.availableReal.visible &&
      invalidCurrency.nextProtectedCommitment === null,
    invalidAggregatesNeverBecomeFabricatedZeroes:
      invalidAggregates.why === null,
    malformedCommitmentIsOmitted:
      invalidCommitment.nextProtectedCommitment === null,
    malformedForecastRiskIsOmitted:
      invalidRisk.firstForecastRisk === null,
    noDataNeverInventsMoney:
      noData.kind === "NO_DATA" &&
      noData.currency === null &&
      !noData.availableReal.visible &&
      noData.availableReal.amountMinor === null &&
      noData.why === null,
    readErrorNeverReusesLastMoney:
      error.kind === "ERROR" &&
      !error.availableReal.visible &&
      error.availableReal.amountMinor === null &&
      error.attention.required,
    publicSurfaceDoesNotCarryInternalEvidence:
      !publicJson.includes("contextRevision") &&
      !publicJson.includes('"explanationRefs"') &&
      !publicJson.includes("ledgerEntries") &&
      !publicJson.includes("sourceEventId") &&
      !publicJson.includes("providerKey"),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    safe,
    attention,
    action,
    degraded,
    noData,
    error,
  };
}
