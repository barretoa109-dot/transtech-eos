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

export interface PersistedFinancialContextRecord {
  userId: string;
  revision: string;
  currency: string;
  status: FinancialStatus;
  horizonUntil: string;
  liquidityUsableMinor: number;
  protectedCommitmentsMinor: number;
  protectedReserveMinor: number;
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

function assertNonNegativeFinite(value: number, errorCode: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(errorCode);
  return Math.trunc(value);
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

function builtContextFromRecord(
  record: PersistedFinancialContextRecord,
  nowIso: string,
): BuiltFinancialContext {
  const now = parseTime(nowIso, "financial_state_invalid_now");
  const generatedAt = parseTime(record.generatedAt, "financial_state_invalid_generated_at");
  const horizonUntil = parseTime(record.horizonUntil, "financial_state_invalid_horizon");
  const validUntil = parseTime(record.validUntil, "financial_state_invalid_valid_until");
  if (now === null || generatedAt === null || horizonUntil === null) {
    throw new Error("financial_state_invalid_context_time");
  }
  if (generatedAt > now + 5 * 60 * 1000) {
    throw new Error("financial_state_context_from_future");
  }

  const liquidityUsableMinor = assertNonNegativeFinite(
    record.liquidityUsableMinor,
    "financial_state_invalid_liquidity",
  );
  const protectedCommitmentsMinor = assertNonNegativeFinite(
    record.protectedCommitmentsMinor,
    "financial_state_invalid_commitments",
  );
  const protectedReserveMinor = assertNonNegativeFinite(
    record.protectedReserveMinor,
    "financial_state_invalid_reserve",
  );
  const availableRealSafeMinor = assertNonNegativeFinite(
    record.availableRealSafeMinor,
    "financial_state_invalid_available",
  );
  if (!Number.isFinite(record.minimumProjectedCashMinor)) {
    throw new Error("financial_state_invalid_minimum_cash");
  }

  const expired = validUntil === null || validUntil < now;
  const degraded = record.status === "DEGRADED" || !record.sourcesFresh || expired;
  const status: FinancialStatus = degraded ? "DEGRADED" : record.status;
  const reserveGapMinor = Math.max(
    0,
    protectedReserveMinor - Math.trunc(record.minimumProjectedCashMinor),
  );

  return {
    currency: record.currency,
    asOf: nowIso,
    horizonUntil: record.horizonUntil,
    liquidityUsableMinor,
    protectedCommitmentsMinor,
    minimumProjectedCashMinor: Math.trunc(record.minimumProjectedCashMinor),
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

/**
 * Server-side resolver contract for Web/App.
 *
 * The caller supplies a trusted user id derived from the authenticated server
 * session. Reader results are treated as untrusted until ownership, validity,
 * freshness and numeric invariants are checked. No raw Ledger data is returned.
 */
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

  const context = builtContextFromRecord(record, input.nowIso);
  const obligations = await input.reader.getOpenObligations({
    userId: input.trustedUserId,
    currency: record.currency,
    horizonUntil: record.horizonUntil,
  });

  if (obligations.some((obligation) => obligation.userId !== input.trustedUserId)) {
    throw new Error("financial_state_obligation_owner_mismatch");
  }

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
