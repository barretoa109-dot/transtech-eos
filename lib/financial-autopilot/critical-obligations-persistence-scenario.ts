import {
  CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX,
  parsePersistedCriticalObligationsComplete,
  upgradeFinancialPersistencePlanWithCriticalObligations,
  type FinancialPersistencePlanV1_2,
} from "./critical-obligations-persistence";
import { upgradeFinancialPersistencePlanWithFirstForecastRisk } from "./first-forecast-risk-persistence";
import type { FinancialPersistencePlan } from "./persistence";
import {
  SupabaseFinancialPersistenceStoreV1_2,
  type FinancialPersistenceRpcClientV1_2,
} from "./supabase-persistence-store-v1-2";

const USER_ID = "00000000-0000-4000-8000-000000000096";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000097";
const BASE_FINGERPRINT = "2".repeat(64);
const SHA256_HEX = /^[a-f0-9]{64}$/;

function basePlan(userId = USER_ID): FinancialPersistencePlan {
  return {
    version: "financial-persistence-plan-v1",
    userId,
    providerKey: "mock_critical_obligations_v1_2",
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

function v1_1Plan(userId = USER_ID) {
  return upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan: basePlan(userId),
    firstRisk: null,
  });
}

class FakeRpcClient implements FinancialPersistenceRpcClientV1_2 {
  calls: Array<{
    functionName: string;
    trustedUserId: string;
    batch: FinancialPersistencePlanV1_2;
  }> = [];

  mode: "success" | "error" | "revision_mismatch" = "success";

  async rpc(
    functionName: "eos_financial_persist_snapshot_v1_2",
    args: { p_usuario_id: string; p_batch: FinancialPersistencePlanV1_2 },
  ) {
    this.calls.push({
      functionName,
      trustedUserId: args.p_usuario_id,
      batch: args.p_batch,
    });

    if (this.mode === "error") {
      return { data: null, error: { code: "XX002", message: "fixture error" } };
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

export async function runCriticalObligationsPersistenceScenario() {
  const complete = upgradeFinancialPersistencePlanWithCriticalObligations({
    plan: v1_1Plan(),
    criticalObligationsComplete: true,
  });
  const replay = upgradeFinancialPersistencePlanWithCriticalObligations({
    plan: v1_1Plan(),
    criticalObligationsComplete: true,
  });
  const incomplete = upgradeFinancialPersistencePlanWithCriticalObligations({
    plan: v1_1Plan(),
    criticalObligationsComplete: false,
  });

  const malformedBooleanBlocked = await catchesCode(
    () => parsePersistedCriticalObligationsComplete("true"),
    "financial_state_invalid_critical_obligations_complete",
  );

  const noIntegrity = v1_1Plan();
  noIntegrity.contextInsert.explanationRefs =
    noIntegrity.contextInsert.explanationRefs.filter(
      (ref) => !ref.startsWith("context-integrity:"),
    );
  const missingAggregateIntegrityBlocked = await catchesCode(
    () =>
      upgradeFinancialPersistencePlanWithCriticalObligations({
        plan: noIntegrity,
        criticalObligationsComplete: true,
      }),
    "financial_persistence_context_integrity_ref_missing",
  );

  const client = new FakeRpcClient();
  const store = new SupabaseFinancialPersistenceStoreV1_2(client, USER_ID);
  const success = await store.persist(complete);
  const callsAfterSuccess = client.calls.length;

  const crossUser = upgradeFinancialPersistencePlanWithCriticalObligations({
    plan: v1_1Plan(OTHER_USER_ID),
    criticalObligationsComplete: true,
  });
  const crossUserBlocked = await catchesCode(
    () => store.persist(crossUser),
    "financial_persistence_user_mismatch",
  );
  const callsAfterCrossUser = client.calls.length;

  client.mode = "revision_mismatch";
  const revisionMismatchBlocked = await catchesCode(
    () => store.persist(complete),
    "financial_persistence_context_revision_mismatch",
  );

  client.mode = "error";
  const rpcErrorBlocked = await catchesCode(
    () => store.persist(complete),
    "financial_persistence_rpc_failed:XX002",
  );

  const completenessRefs = complete.contextInsert.explanationRefs.filter((ref) =>
    ref.startsWith(CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX),
  );
  const checks = {
    explicitBooleanPersisted:
      complete.contextInsert.criticalObligationsComplete === true &&
      incomplete.contextInsert.criticalObligationsComplete === false,
    completenessCommitsToContextIdentity:
      completenessRefs.length === 1 &&
      SHA256_HEX.test(complete.contextInsert.sourceFingerprint) &&
      complete.contextInsert.revision ===
        `ctx:${complete.contextInsert.sourceFingerprint}`,
    exactInputProducesExactIdentity:
      complete.contextInsert.sourceFingerprint ===
        replay.contextInsert.sourceFingerprint,
    booleanChangeChangesContextRevision:
      complete.contextInsert.revision !== incomplete.contextInsert.revision,
    malformedBooleanFailsClosed: malformedBooleanBlocked,
    aggregateIntegrityIsRequired: missingAggregateIntegrityBlocked,
    wrapperRpcIsFixed:
      client.calls[0]?.functionName === "eos_financial_persist_snapshot_v1_2",
    trustedUserPassedSeparately:
      client.calls[0]?.trustedUserId === USER_ID &&
      client.calls[0]?.batch.userId === USER_ID,
    crossUserBlockedBeforeRpc:
      crossUserBlocked &&
      callsAfterSuccess === 1 &&
      callsAfterCrossUser === callsAfterSuccess,
    persistenceReturnsMatchingRevision:
      success.contextRevision === complete.contextInsert.revision,
    revisionMismatchFailsClosed: revisionMismatchBlocked,
    rpcErrorFailsClosed: rpcErrorBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    completeRevision: complete.contextInsert.revision,
    incompleteRevision: incomplete.contextInsert.revision,
    completenessRef: completenessRefs[0] ?? null,
    rpcCalls: client.calls.length,
  };
}
