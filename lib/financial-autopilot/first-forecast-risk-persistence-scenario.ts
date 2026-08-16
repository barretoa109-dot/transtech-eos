import {
  parsePersistedFirstForecastRisk,
  upgradeFinancialPersistencePlanWithFirstForecastRisk,
  type FinancialPersistencePlanV1_1,
} from "./first-forecast-risk-persistence";
import type { FinancialPersistencePlan } from "./persistence";
import {
  SupabaseFinancialPersistenceStoreV1_1,
  type FinancialPersistenceRpcClientV1_1,
} from "./supabase-persistence-store-v1-1";

const USER_ID = "00000000-0000-4000-8000-000000000090";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000091";
const BASE_FINGERPRINT = "1".repeat(64);
const SHA256_HEX = /^[a-f0-9]{64}$/;

function basePlan(userId = USER_ID): FinancialPersistencePlan {
  return {
    version: "financial-persistence-plan-v1",
    userId,
    providerKey: "mock_first_risk_v1_1",
    connectionUpserts: [],
    accountUpserts: [],
    ingestionEventUpserts: [],
    ledgerUpserts: [],
    reconciliationInserts: [],
    recurrenceUpserts: [],
    obligationUpserts: [],
    contextInsert: {
      userId,
      revision: `ctx:${BASE_FINGERPRINT}`,
      sourceFingerprint: BASE_FINGERPRINT,
      currency: "PYG",
      status: "SAFE",
      horizonUntil: "2026-09-01T12:00:00.000Z",
      horizonReason: "rolling_fallback",
      liquidityUsableMinor: 8000000,
      protectedCommitmentsMinor: 2100000,
      essentialSpendExpectedMinor: 800000,
      protectedReserveMinor: 3000000,
      criticalProvisionsMinor: 100000,
      confirmedIncomeMinor: 0,
      uncertaintyBufferMinor: 360000,
      availableRealSafeMinor: 1640000,
      minimumProjectedCashMinor: 6005000,
      minimumProjectedCashAt: "2026-08-25T00:00:00.000Z",
      confidence: {
        sourceFreshness: 0.98,
        incomePredictability: 0.95,
        expensePredictability: 0.82,
        obligationCompleteness: 0.96,
        reconciliationQuality: 1,
        overall: 0.94,
      },
      explanationRefs: [],
      sourcesFresh: true,
      generatedAt: "2026-08-16T12:00:00.000Z",
      validUntil: "2026-08-17T12:00:00.000Z",
    },
  };
}

const ATTENTION_RISK = {
  days: 60,
  until: "2026-10-15T12:00:00.000Z",
  status: "ATTENTION" as const,
  reserveGapMinor: 750000,
  negativeCashGapMinor: 0,
};

class FakeRpcClient implements FinancialPersistenceRpcClientV1_1 {
  calls: Array<{
    functionName: string;
    trustedUserId: string;
    batch: FinancialPersistencePlanV1_1;
  }> = [];

  mode: "success" | "error" | "revision_mismatch" = "success";

  async rpc(
    functionName: "eos_financial_persist_snapshot_v1_1",
    args: { p_usuario_id: string; p_batch: FinancialPersistencePlanV1_1 },
  ) {
    this.calls.push({
      functionName,
      trustedUserId: args.p_usuario_id,
      batch: args.p_batch,
    });

    if (this.mode === "error") {
      return { data: null, error: { code: "XX001", message: "fixture error" } };
    }

    return {
      data: {
        replayed: false,
        contextRevision:
          this.mode === "revision_mismatch"
            ? `ctx:${"f".repeat(64)}`
            : args.p_batch.contextInsert.revision,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
        reconciliationRowsTouched: 0,
      },
      error: null,
    };
  }
}

async function catchesCode(work: () => unknown | Promise<unknown>, code: string) {
  try {
    await work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

export async function runFirstForecastRiskPersistenceScenario() {
  const first = upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan: basePlan(),
    firstRisk: ATTENTION_RISK,
  });
  const replay = upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan: basePlan(),
    firstRisk: ATTENTION_RISK,
  });
  const changedRisk = upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan: basePlan(),
    firstRisk: {
      ...ATTENTION_RISK,
      status: "ACTION_REQUIRED",
      reserveGapMinor: 3750000,
      negativeCashGapMinor: 750000,
    },
  });
  const noRisk = upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan: basePlan(),
    firstRisk: null,
  });

  const malformedRiskBlocked = await catchesCode(
    () =>
      parsePersistedFirstForecastRisk({
        status: "SAFE",
        horizonDays: 30,
        until: ATTENTION_RISK.until,
        reserveGapMinor: 0,
        negativeCashGapMinor: 0,
      }),
    "financial_state_invalid_first_forecast_risk",
  );
  const unsafeGapBlocked = await catchesCode(
    () =>
      parsePersistedFirstForecastRisk({
        status: "ATTENTION",
        horizonDays: 30,
        until: ATTENTION_RISK.until,
        reserveGapMinor: Number.MAX_SAFE_INTEGER + 1,
        negativeCashGapMinor: 0,
      }),
    "financial_state_invalid_first_forecast_risk",
  );

  const client = new FakeRpcClient();
  const store = new SupabaseFinancialPersistenceStoreV1_1(client, USER_ID);
  const success = await store.persist(first);
  const callsAfterSuccess = client.calls.length;

  const crossUser = upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan: basePlan(OTHER_USER_ID),
    firstRisk: ATTENTION_RISK,
  });
  const crossUserBlocked = await catchesCode(
    () => store.persist(crossUser),
    "financial_persistence_user_mismatch",
  );
  const callsAfterCrossUser = client.calls.length;

  client.mode = "revision_mismatch";
  const revisionMismatchBlocked = await catchesCode(
    () => store.persist(first),
    "financial_persistence_context_revision_mismatch",
  );

  client.mode = "error";
  const rpcErrorBlocked = await catchesCode(
    () => store.persist(first),
    "financial_persistence_rpc_failed:XX001",
  );

  const checks = {
    riskIsPersistedCompactly:
      first.contextInsert.firstForecastRisk?.status === "ATTENTION" &&
      first.contextInsert.firstForecastRisk.horizonDays === 60 &&
      first.contextInsert.firstForecastRisk.reserveGapMinor === 750000,
    firstRiskCommitsToContextIdentity:
      SHA256_HEX.test(first.contextInsert.sourceFingerprint) &&
      first.contextInsert.revision === `ctx:${first.contextInsert.sourceFingerprint}` &&
      first.contextInsert.sourceFingerprint !== BASE_FINGERPRINT,
    exactInputProducesExactIdentity:
      first.contextInsert.sourceFingerprint === replay.contextInsert.sourceFingerprint &&
      JSON.stringify(first.contextInsert.firstForecastRisk) ===
        JSON.stringify(replay.contextInsert.firstForecastRisk),
    riskChangeChangesContextRevision:
      first.contextInsert.revision !== changedRisk.contextInsert.revision,
    nullRiskIsExplicitlyPersisted: noRisk.contextInsert.firstForecastRisk === null,
    malformedRiskFailsClosed: malformedRiskBlocked,
    unsafeRiskMoneyFailsClosed: unsafeGapBlocked,
    wrapperRpcIsFixed:
      client.calls[0]?.functionName === "eos_financial_persist_snapshot_v1_1",
    trustedUserPassedSeparately:
      client.calls[0]?.trustedUserId === USER_ID &&
      client.calls[0]?.batch.userId === USER_ID,
    crossUserBlockedBeforeRpc:
      crossUserBlocked &&
      callsAfterSuccess === 1 &&
      callsAfterCrossUser === callsAfterSuccess,
    persistenceReturnsMatchingRevision:
      success.contextRevision === first.contextInsert.revision,
    revisionMismatchFailsClosed: revisionMismatchBlocked,
    rpcErrorFailsClosed: rpcErrorBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    firstForecastRisk: first.contextInsert.firstForecastRisk,
    contextRevision: first.contextInsert.revision,
    changedRiskRevision: changedRisk.contextInsert.revision,
    noRiskRevision: noRisk.contextInsert.revision,
    rpcCalls: client.calls.length,
  };
}
