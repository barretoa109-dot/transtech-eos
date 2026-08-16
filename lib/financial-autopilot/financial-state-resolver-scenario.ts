import {
  resolveFinancialState,
  type FinancialStateReader,
  type PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import type { FinancialObligation } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000070";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000071";
const NOW = "2026-08-16T04:30:00.000Z";
const SAFE_REVISION = `ctx:${"a".repeat(64)}`;
const EXPIRED_REVISION = `ctx:${"b".repeat(64)}`;
const ACTION_REVISION = `ctx:${"c".repeat(64)}`;

function contextRecord(
  overrides: Partial<PersistedFinancialContextRecord> = {},
): PersistedFinancialContextRecord {
  return {
    userId: USER_ID,
    revision: SAFE_REVISION,
    currency: "PYG",
    status: "SAFE",
    horizonUntil: "2026-09-01T12:00:00.000Z",
    liquidityUsableMinor: 8000000,
    protectedCommitmentsMinor: 2100000,
    protectedReserveMinor: 3000000,
    availableRealSafeMinor: 1640000,
    minimumProjectedCashMinor: 6005000,
    minimumProjectedCashAt: "2026-08-25T00:00:00.000Z",
    confidence: {
      sourceFreshness: 0.98,
      incomePredictability: 1,
      expensePredictability: 0.73,
      obligationCompleteness: 0.96,
      reconciliationQuality: 1,
      overall: 0.932,
    },
    explanationRefs: ["account:checking", "obligation:rent"],
    sourcesFresh: true,
    generatedAt: "2026-08-16T04:00:00.000Z",
    validUntil: "2026-08-17T12:00:00.000Z",
    firstForecastRisk: null,
    ...overrides,
  };
}

function obligations(userId = USER_ID): FinancialObligation[] {
  return [
    {
      id: "resolver-rent",
      userId,
      type: "housing",
      amountMinor: 2100000,
      currency: "PYG",
      dueAt: "2026-08-25T00:00:00.000Z",
      priority: 100,
      mustProtect: true,
      confidence: 0.95,
      source: "resolver_fixture",
    },
  ];
}

class FixtureReader implements FinancialStateReader {
  constructor(
    private readonly record: PersistedFinancialContextRecord | null,
    private readonly rows: FinancialObligation[] = obligations(),
  ) {}

  async getLatestContext(_userId: string) {
    return this.record;
  }

  async getOpenObligations(_input: {
    userId: string;
    currency: string;
    horizonUntil: string;
  }) {
    return this.rows;
  }
}

async function catchesCode(work: () => Promise<unknown>, code: string) {
  try {
    await work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

export async function runFinancialStateResolverScenario() {
  const healthy = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader: new FixtureReader(contextRecord()),
    nowIso: NOW,
  });

  const noData = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader: new FixtureReader(null),
    nowIso: NOW,
  });

  const expired = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader: new FixtureReader(
      contextRecord({
        revision: EXPIRED_REVISION,
        validUntil: "2026-08-16T03:00:00.000Z",
      }),
    ),
    nowIso: NOW,
  });

  const expiredHorizon = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader: new FixtureReader(
      contextRecord({
        revision: `ctx:${"d".repeat(64)}`,
        generatedAt: "2026-08-15T03:00:00.000Z",
        horizonUntil: "2026-08-16T03:30:00.000Z",
        validUntil: "2026-08-16T03:30:00.000Z",
        minimumProjectedCashAt: "2026-08-16T03:00:00.000Z",
      }),
      [],
    ),
    nowIso: NOW,
  });

  const actionRequired = await resolveFinancialState({
    trustedUserId: USER_ID,
    reader: new FixtureReader(
      contextRecord({
        revision: ACTION_REVISION,
        status: "ACTION_REQUIRED",
        liquidityUsableMinor: 4000000,
        availableRealSafeMinor: 0,
        minimumProjectedCashMinor: -1700000,
        firstForecastRisk: {
          status: "ACTION_REQUIRED",
          horizonDays: 30,
          until: "2026-09-15T04:30:00.000Z",
          reserveGapMinor: 4700000,
          negativeCashGapMinor: 1700000,
        },
      }),
    ),
    nowIso: NOW,
  });

  const ownerMismatchBlocked = await catchesCode(
    () =>
      resolveFinancialState({
        trustedUserId: USER_ID,
        reader: new FixtureReader(contextRecord({ userId: OTHER_USER_ID })),
        nowIso: NOW,
      }),
    "financial_state_owner_mismatch",
  );

  const obligationOwnerMismatchBlocked = await catchesCode(
    () =>
      resolveFinancialState({
        trustedUserId: USER_ID,
        reader: new FixtureReader(contextRecord(), obligations(OTHER_USER_ID)),
        nowIso: NOW,
      }),
    "financial_state_obligation_owner_mismatch",
  );

  const futureContextBlocked = await catchesCode(
    () =>
      resolveFinancialState({
        trustedUserId: USER_ID,
        reader: new FixtureReader(
          contextRecord({ generatedAt: "2026-08-16T05:30:01.000Z" }),
        ),
        nowIso: NOW,
      }),
    "financial_state_context_from_future",
  );

  const malformedRevisionBlocked = await catchesCode(
    () =>
      resolveFinancialState({
        trustedUserId: USER_ID,
        reader: new FixtureReader(contextRecord({ revision: "ctx:not-a-hash" })),
        nowIso: NOW,
      }),
    "financial_state_invalid_revision",
  );

  const decimalMoneyBlocked = await catchesCode(
    () =>
      resolveFinancialState({
        trustedUserId: USER_ID,
        reader: new FixtureReader(contextRecord({ liquidityUsableMinor: 1.5 })),
        nowIso: NOW,
      }),
    "financial_state_invalid_liquidity",
  );

  const validityBeyondHorizonBlocked = await catchesCode(
    () =>
      resolveFinancialState({
        trustedUserId: USER_ID,
        reader: new FixtureReader(
          contextRecord({ validUntil: "2026-09-02T12:00:00.000Z" }),
        ),
        nowIso: NOW,
      }),
    "financial_state_validity_exceeds_horizon",
  );

  const healthyState = healthy.kind === "STATE" ? healthy.state : null;
  const expiredState = expired.kind === "STATE" ? expired.state : null;
  const expiredHorizonState = expiredHorizon.kind === "STATE" ? expiredHorizon.state : null;
  const actionState = actionRequired.kind === "STATE" ? actionRequired.state : null;
  const publicJson = JSON.stringify(healthyState);

  const checks = {
    healthyStateResolvedForTrustedUser:
      healthy.kind === "STATE" &&
      healthyState?.status === "SAFE" &&
      healthyState.contextRevision === SAFE_REVISION,
    healthyAvailableRealExposed:
      healthyState?.canAssertSafety === true &&
      healthyState.money.availableRealMinor === 1640000,
    nextProtectedCommitmentResolved:
      healthyState?.nextProtectedCommitment?.type === "housing" &&
      healthyState.nextProtectedCommitment.amountMinor === 2100000,
    noDataIsExplicitNotFakeSafe:
      noData.kind === "NO_DATA" &&
      noData.state === null &&
      noData.reason === "no_financial_context",
    expiredContextFailsClosed:
      expiredState?.status === "DEGRADED" &&
      expiredState.canAssertSafety === false &&
      expiredState.money.availableRealMinor === null &&
      expiredState.attention.outcome === "CONNECTION_REQUIRED",
    expiredHorizonAlsoFailsClosed:
      expiredHorizonState?.status === "DEGRADED" &&
      expiredHorizonState.canAssertSafety === false &&
      expiredHorizonState.money.availableRealMinor === null,
    actionRequiredEscalatesOneDecision:
      actionState?.status === "ACTION_REQUIRED" &&
      actionState.attention.outcome === "USER_DECISION_REQUIRED" &&
      actionState.attention.required &&
      actionState.attention.interrupt,
    persistedFirstRiskSurvivesProjection:
      actionState?.firstForecastRisk?.status === "ACTION_REQUIRED" &&
      actionState.firstForecastRisk.negativeCashGapMinor === 1700000,
    ownerMismatchFailsClosed: ownerMismatchBlocked,
    obligationOwnerMismatchFailsClosed: obligationOwnerMismatchBlocked,
    impossibleFutureContextFailsClosed: futureContextBlocked,
    malformedRevisionFailsClosed: malformedRevisionBlocked,
    decimalMoneyFailsClosed: decimalMoneyBlocked,
    validityCannotOutliveHorizon: validityBeyondHorizonBlocked,
    resolverStillDoesNotLeakLedgerInternals:
      !publicJson.includes("explanationRefs") &&
      !publicJson.includes("ledgerEntries") &&
      !publicJson.includes("sourceEventId") &&
      !publicJson.includes("degradedReasons"),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy: healthyState,
    noData,
    expired: expiredState,
    expiredHorizon: expiredHorizonState,
    actionRequired: actionState,
  };
}
