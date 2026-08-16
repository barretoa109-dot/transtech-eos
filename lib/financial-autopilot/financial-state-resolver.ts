import type { BuiltFinancialContext } from "./context";
import { generateFinancialDecisionCandidates } from "./decision-candidates";
import { selectNextBestFinancialAction } from "./decision";
import type { ForecastHorizonsResult } from "./forecast-horizons";
import {
  buildFinancialStateView,
  type FinancialStateRiskView,
  type FinancialStateView,
} from "./financial-state";
import type {
  FinancialContextConfidence,
  FinancialObligation,
  FinancialStatus,
} from "./types";

const CONTEXT_REVISION = /^ctx:[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const SAFE_CONFIDENCE_THRESHOLD = 0.8;
const CONFIDENCE_TOLERANCE = 0.000001;
const FINANCIAL_STATUSES = new Set<FinancialStatus>([
  "SAFE",
  "ATTENTION",
  "ACTION_REQUIRED",
  "DEGRADED",
]);

export interface PersistedFinancialContextRecord {
  userId: string;
  revision: string;
  currency: string;
  status: FinancialStatus;
  horizonUntil: string;
  liquidityUsableMinor: number;
  protectedCommitmentsMinor: number;
  essentialSpendExpectedMinor: number;
  protectedReserveMinor: number;
  criticalProvisionsMinor: number;
  confirmedIncomeMinor: number;
  uncertaintyBufferMinor: number;
  availableRealSafeMinor: number;
  minimumProjectedCashMinor: number;
  minimumProjectedCashAt: string | null;
  confidence: FinancialContextConfidence;
  explanationRefs: string[];
  sourcesFresh: boolean;
  generatedAt: string;
  validUntil: string | null;
  firstForecastRisk?: FinancialStateRiskView | null;
}

export interface FinancialStateReader {
  getLatestContext(userId: string): Promise<PersistedFinancialContextRecord | null>;
  getOpenObligations(input: {
    userId: string;
    currency: string;
    horizonUntil: string;
  }): Promise<FinancialObligation[]>;
}

export type FinancialStateResolution =
  | {
      kind: "STATE";
      state: FinancialStateView;
    }
  | {
      kind: "NO_DATA";
      state: null;
      reason: "no_financial_context";
    };

function parseTime(value: string | null, errorCode: string) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(errorCode);
  return time;
}

function assertSafeInteger(value: number, errorCode: string, allowNegative = false) {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new Error(errorCode);
  }
  return value;
}

function assertConfidence(confidence: FinancialContextConfidence) {
  for (const value of Object.values(confidence)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("financial_state_invalid_confidence");
    }
  }
}

function assertFirstRisk(
  risk: FinancialStateRiskView | null | undefined,
  generatedAtMs: number,
) {
  if (!risk) return;
  if (risk.status !== "ATTENTION" && risk.status !== "ACTION_REQUIRED") {
    throw new Error("financial_state_invalid_first_risk");
  }
  if (!Number.isSafeInteger(risk.horizonDays) || risk.horizonDays <= 0) {
    throw new Error("financial_state_invalid_first_risk");
  }
  const until = parseTime(risk.until, "financial_state_invalid_first_risk");
  if (until === null || until <= generatedAtMs) {
    throw new Error("financial_state_invalid_first_risk");
  }
  const reserveGapMinor = assertSafeInteger(
    risk.reserveGapMinor,
    "financial_state_invalid_first_risk",
  );
  const negativeCashGapMinor = assertSafeInteger(
    risk.negativeCashGapMinor,
    "financial_state_invalid_first_risk",
  );

  if (
    risk.status === "ATTENTION" &&
    (reserveGapMinor <= 0 || negativeCashGapMinor !== 0)
  ) {
    throw new Error("financial_state_invalid_first_risk");
  }
  if (
    risk.status === "ACTION_REQUIRED" &&
    (negativeCashGapMinor <= 0 || reserveGapMinor < negativeCashGapMinor)
  ) {
    throw new Error("financial_state_invalid_first_risk");
  }
}

function syntheticHorizons(record: PersistedFinancialContextRecord): ForecastHorizonsResult {
  const first = record.firstForecastRisk ?? null;
  return {
    asOf: record.generatedAt,
    currency: record.currency,
    protectedReserveMinor: record.protectedReserveMinor,
    horizons: [],
    firstRisk: first
      ? {
          days: first.horizonDays,
          until: first.until,
          status: first.status,
          reserveGapMinor: first.reserveGapMinor,
          negativeCashGapMinor: first.negativeCashGapMinor,
        }
      : null,
  };
}

function persistedFirstRiskStillFuture(
  record: PersistedFinancialContextRecord,
  nowIso: string,
) {
  if (!record.firstForecastRisk) return true;
  const now = parseTime(nowIso, "financial_state_invalid_now");
  const until = parseTime(
    record.firstForecastRisk.until,
    "financial_state_invalid_first_risk",
  );
  return now !== null && until !== null && until > now;
}

function persistedAvailableRealMatchesInputs(record: PersistedFinancialContextRecord) {
  let computed = record.liquidityUsableMinor;
  const deltas = [
    -record.protectedCommitmentsMinor,
    -record.essentialSpendExpectedMinor,
    -record.protectedReserveMinor,
    -record.criticalProvisionsMinor,
    record.confirmedIncomeMinor,
    -record.uncertaintyBufferMinor,
  ];

  for (const delta of deltas) {
    const next = computed + delta;
    if (!Number.isSafeInteger(next)) return false;
    computed = next;
  }

  return Math.max(0, computed) === record.availableRealSafeMinor;
}

function expectedConfidenceOverall(confidence: FinancialContextConfidence) {
  return Math.max(
    0,
    Math.min(
      1,
      0.3 * confidence.sourceFreshness +
        0.2 * confidence.incomePredictability +
        0.2 * confidence.expensePredictability +
        0.2 * confidence.obligationCompleteness +
        0.1 * confidence.reconciliationQuality,
    ),
  );
}

function persistedConfidenceSupportsContext(record: PersistedFinancialContextRecord) {
  const expectedOverall = expectedConfidenceOverall(record.confidence);
  if (Math.abs(expectedOverall - record.confidence.overall) > CONFIDENCE_TOLERANCE) {
    return false;
  }

  if (record.status !== "SAFE") return true;

  return (
    record.confidence.overall >= SAFE_CONFIDENCE_THRESHOLD &&
    record.confidence.sourceFreshness >= SAFE_CONFIDENCE_THRESHOLD &&
    record.confidence.obligationCompleteness >= SAFE_CONFIDENCE_THRESHOLD
  );
}

function persistedSafetySignalsMatchStatus(input: {
  status: FinancialStatus;
  sourcesFresh: boolean;
  protectedReserveMinor: number;
  availableRealSafeMinor: number;
  minimumProjectedCashMinor: number;
}) {
  if (input.status === "SAFE") {
    return (
      input.sourcesFresh &&
      input.minimumProjectedCashMinor >= input.protectedReserveMinor
    );
  }

  if (input.status === "ACTION_REQUIRED") {
    return (
      input.availableRealSafeMinor === 0 ||
      input.minimumProjectedCashMinor < input.protectedReserveMinor
    );
  }

  return true;
}

function builtContextFromRecord(
  record: PersistedFinancialContextRecord,
  nowIso: string,
): BuiltFinancialContext {
  if (!CONTEXT_REVISION.test(record.revision)) {
    throw new Error("financial_state_invalid_revision");
  }
  if (!CURRENCY.test(record.currency)) throw new Error("financial_state_invalid_currency");
  if (!FINANCIAL_STATUSES.has(record.status)) throw new Error("financial_state_invalid_status");
  if (!Array.isArray(record.explanationRefs) || record.explanationRefs.some((ref) => typeof ref !== "string")) {
    throw new Error("financial_state_invalid_explanation_refs");
  }
  if (typeof record.sourcesFresh !== "boolean") {
    throw new Error("financial_state_invalid_sources_fresh");
  }
  assertConfidence(record.confidence);

  const now = parseTime(nowIso, "financial_state_invalid_now");
  const generatedAt = parseTime(record.generatedAt, "financial_state_invalid_generated_at");
  const horizonUntil = parseTime(record.horizonUntil, "financial_state_invalid_horizon");
  const validUntil = parseTime(record.validUntil, "financial_state_invalid_valid_until");
  const minimumProjectedCashAt = parseTime(
    record.minimumProjectedCashAt,
    "financial_state_invalid_minimum_cash_at",
  );
  if (now === null || generatedAt === null || horizonUntil === null) {
    throw new Error("financial_state_invalid_context_time");
  }
  if (generatedAt > now + 5 * 60 * 1000) {
    throw new Error("financial_state_context_from_future");
  }
  if (generatedAt > horizonUntil) {
    throw new Error("financial_state_generated_after_horizon");
  }
  if (validUntil !== null && validUntil > horizonUntil) {
    throw new Error("financial_state_validity_exceeds_horizon");
  }
  if (minimumProjectedCashAt !== null && minimumProjectedCashAt > horizonUntil) {
    throw new Error("financial_state_minimum_cash_outside_horizon");
  }
  if (minimumProjectedCashAt !== null && minimumProjectedCashAt < generatedAt) {
    throw new Error("financial_state_minimum_cash_before_generation");
  }

  assertFirstRisk(record.firstForecastRisk, generatedAt);

  const liquidityUsableMinor = assertSafeInteger(
    record.liquidityUsableMinor,
    "financial_state_invalid_liquidity",
  );
  const protectedCommitmentsMinor = assertSafeInteger(
    record.protectedCommitmentsMinor,
    "financial_state_invalid_commitments",
  );
  assertSafeInteger(
    record.essentialSpendExpectedMinor,
    "financial_state_invalid_essential_spend",
  );
  const protectedReserveMinor = assertSafeInteger(
    record.protectedReserveMinor,
    "financial_state_invalid_reserve",
  );
  assertSafeInteger(
    record.criticalProvisionsMinor,
    "financial_state_invalid_critical_provisions",
  );
  assertSafeInteger(
    record.confirmedIncomeMinor,
    "financial_state_invalid_confirmed_income",
  );
  assertSafeInteger(
    record.uncertaintyBufferMinor,
    "financial_state_invalid_uncertainty_buffer",
  );
  const availableRealSafeMinor = assertSafeInteger(
    record.availableRealSafeMinor,
    "financial_state_invalid_available",
  );
  const minimumProjectedCashMinor = assertSafeInteger(
    record.minimumProjectedCashMinor,
    "financial_state_invalid_minimum_cash",
    true,
  );

  const futureSkew = generatedAt > now;
  const expired = validUntil === null || validUntil <= now || horizonUntil <= now;
  const degraded =
    record.status === "DEGRADED" || !record.sourcesFresh || expired || futureSkew;
  const status: FinancialStatus = degraded ? "DEGRADED" : record.status;
  const reserveGapMinor = Math.max(0, protectedReserveMinor - minimumProjectedCashMinor);

  return {
    currency: record.currency,
    asOf: nowIso,
    horizonUntil: record.horizonUntil,
    liquidityUsableMinor,
    protectedCommitmentsMinor,
    minimumProjectedCashMinor,
    minimumProjectedCashAt: record.minimumProjectedCashAt,
    sourcesFresh: !degraded,
    available: {
      status,
      currency: record.currency,
      availableRealRawMinor: degraded ? 0 : availableRealSafeMinor,
      availableRealSafeMinor: degraded ? 0 : availableRealSafeMinor,
      shortfallMinor: status === "ACTION_REQUIRED" ? reserveGapMinor : 0,
      needsUserAction: status === "ACTION_REQUIRED",
      degradedReasons: degraded ? ["persisted_context_not_current"] : [],
    },
    explanationRefs: [...record.explanationRefs],
  };
}

function assertObligations(
  obligations: FinancialObligation[],
  trustedUserId: string,
  currency: string,
  horizonUntil: string,
) {
  const horizonTime = parseTime(horizonUntil, "financial_state_invalid_horizon");
  if (horizonTime === null) throw new Error("financial_state_invalid_horizon");

  for (const obligation of obligations) {
    if (obligation.userId !== trustedUserId) {
      throw new Error("financial_state_obligation_owner_mismatch");
    }
    if (obligation.currency !== currency) {
      throw new Error("financial_state_obligation_currency_mismatch");
    }
    assertSafeInteger(obligation.amountMinor, "financial_state_invalid_obligation_amount");
    assertSafeInteger(obligation.priority, "financial_state_invalid_obligation_priority", true);
    if (
      typeof obligation.confidence !== "number" ||
      !Number.isFinite(obligation.confidence) ||
      obligation.confidence < 0 ||
      obligation.confidence > 1
    ) {
      throw new Error("financial_state_invalid_obligation_confidence");
    }
    if (typeof obligation.mustProtect !== "boolean") {
      throw new Error("financial_state_invalid_obligation_protection");
    }
    if (!obligation.id || !obligation.type || !obligation.source) {
      throw new Error("financial_state_invalid_obligation");
    }
    const dueAt = parseTime(obligation.dueAt, "financial_state_invalid_obligation_due_at");
    if (dueAt === null || dueAt > horizonTime) {
      throw new Error("financial_state_obligation_outside_horizon");
    }
  }
}

function protectedObligations(obligations: FinancialObligation[]) {
  return obligations.filter(
    (obligation) => obligation.mustProtect && obligation.confidence >= 0.75,
  );
}

function obligationsMatchPersistedContext(
  record: PersistedFinancialContextRecord,
  obligations: FinancialObligation[],
) {
  const protectedRows = protectedObligations(obligations);
  let currentTotal = 0;
  for (const obligation of protectedRows) {
    const next = currentTotal + obligation.amountMinor;
    if (!Number.isSafeInteger(next)) return false;
    currentTotal = next;
  }
  if (currentTotal !== record.protectedCommitmentsMinor) return false;

  const persistedRefs = record.explanationRefs
    .filter((ref) => ref.startsWith("obligation:"))
    .sort();
  const currentRefs = protectedRows
    .map((obligation) => `obligation:${obligation.id}`)
    .sort();

  return (
    persistedRefs.length === currentRefs.length &&
    persistedRefs.every((ref, index) => ref === currentRefs[index])
  );
}

function degradeContextForConsistency(
  context: BuiltFinancialContext,
  reason: string,
): BuiltFinancialContext {
  return {
    ...context,
    sourcesFresh: false,
    available: {
      ...context.available,
      status: "DEGRADED",
      availableRealRawMinor: 0,
      availableRealSafeMinor: 0,
      shortfallMinor: 0,
      needsUserAction: false,
      degradedReasons: [...context.available.degradedReasons, reason],
    },
  };
}

export async function resolveFinancialState(input: {
  trustedUserId: string;
  reader: FinancialStateReader;
  nowIso: string;
}): Promise<FinancialStateResolution> {
  if (!input.trustedUserId) throw new Error("financial_state_missing_trusted_user");
  parseTime(input.nowIso, "financial_state_invalid_now");

  const record = await input.reader.getLatestContext(input.trustedUserId);
  if (!record) {
    return {
      kind: "NO_DATA",
      state: null,
      reason: "no_financial_context",
    };
  }

  if (record.userId !== input.trustedUserId) {
    throw new Error("financial_state_owner_mismatch");
  }

  const persistedContext = builtContextFromRecord(record, input.nowIso);
  const arithmeticCheckedContext = persistedAvailableRealMatchesInputs(record)
    ? persistedContext
    : degradeContextForConsistency(
        persistedContext,
        "persisted_available_real_conflicts_with_inputs",
      );

  const confidenceCheckedContext = persistedConfidenceSupportsContext(record)
    ? arithmeticCheckedContext
    : degradeContextForConsistency(
        arithmeticCheckedContext,
        "persisted_confidence_conflicts_with_context",
      );

  const forecastCheckedContext = persistedFirstRiskStillFuture(record, input.nowIso)
    ? confidenceCheckedContext
    : degradeContextForConsistency(
        confidenceCheckedContext,
        "persisted_first_forecast_risk_elapsed",
      );

  const statusConsistent = persistedSafetySignalsMatchStatus({
    status: record.status,
    sourcesFresh: record.sourcesFresh,
    protectedReserveMinor: record.protectedReserveMinor,
    availableRealSafeMinor: record.availableRealSafeMinor,
    minimumProjectedCashMinor: record.minimumProjectedCashMinor,
  });
  const statusCheckedContext = statusConsistent
    ? forecastCheckedContext
    : degradeContextForConsistency(
        forecastCheckedContext,
        "persisted_status_conflicts_with_safety_signals",
      );

  const obligations = await input.reader.getOpenObligations({
    userId: input.trustedUserId,
    currency: record.currency,
    horizonUntil: record.horizonUntil,
  });
  assertObligations(
    obligations,
    input.trustedUserId,
    record.currency,
    record.horizonUntil,
  );

  const context = obligationsMatchPersistedContext(record, obligations)
    ? statusCheckedContext
    : degradeContextForConsistency(
        statusCheckedContext,
        "persisted_obligations_changed_after_context",
      );

  const candidates = generateFinancialDecisionCandidates({
    financialContext: context,
    protectedReserveMinor: record.protectedReserveMinor,
  });
  const nextAction = selectNextBestFinancialAction(context.available.status, candidates);

  return {
    kind: "STATE",
    state: buildFinancialStateView({
      context,
      protectedReserveMinor: record.protectedReserveMinor,
      obligations,
      nextAction,
      horizons: syntheticHorizons(record),
      sourceFreshUntil: record.validUntil,
      contextRevision: record.revision,
    }),
  };
}
