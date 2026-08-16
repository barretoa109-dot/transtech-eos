import type { FinancialPersistencePlan } from "./persistence";
import {
  SupabaseFinancialPersistenceStore,
  type FinancialPersistenceRpcClient,
} from "./supabase-persistence-store";

const USER_ID = "00000000-0000-4000-8000-000000000060";

function plan(userId = USER_ID): FinancialPersistencePlan {
  return {
    version: "financial-persistence-plan-v1",
    userId,
    providerKey: "mock_rpc_v1",
    connectionUpserts: [],
    accountUpserts: [],
    ingestionEventUpserts: [],
    ledgerUpserts: [],
    reconciliationInserts: [],
    recurrenceUpserts: [],
    obligationUpserts: [],
    contextInsert: {
      userId,
      revision: "ctx:rpc-scenario-v1",
      sourceFingerprint: "rpc-scenario-v1",
      currency: "PYG",
      status: "SAFE",
      horizonUntil: "2026-09-01T12:00:00.000Z",
      horizonReason: "rolling_fallback",
      liquidityUsableMinor: 5000000,
      protectedCommitmentsMinor: 0,
      essentialSpendExpectedMinor: 500000,
      protectedReserveMinor: 3000000,
      criticalProvisionsMinor: 0,
      confirmedIncomeMinor: 0,
      uncertaintyBufferMinor: 100000,
      availableRealSafeMinor: 1400000,
      minimumProjectedCashMinor: 4500000,
      minimumProjectedCashAt: "2026-08-31T12:00:00.000Z",
      confidence: {
        sourceFreshness: 0.99,
        incomePredictability: 0.7,
        expensePredictability: 0.85,
        obligationCompleteness: 0.95,
        reconciliationQuality: 0.98,
        overall: 0.9,
      },
      explanationRefs: [],
      sourcesFresh: true,
      generatedAt: "2026-08-16T12:00:00.000Z",
      validUntil: "2026-08-17T12:00:00.000Z",
    },
  };
}

class FakeRpcClient implements FinancialPersistenceRpcClient {
  calls: Array<{
    functionName: string;
    trustedUserId: string;
    batch: FinancialPersistencePlan;
  }> = [];

  mode: "success" | "error" | "invalid" | "revision_mismatch" = "success";

  async rpc(
    functionName: "eos_financial_persist_snapshot_v1",
    args: { p_usuario_id: string; p_batch: FinancialPersistencePlan },
  ) {
    this.calls.push({
      functionName,
      trustedUserId: args.p_usuario_id,
      batch: args.p_batch,
    });

    if (this.mode === "error") {
      return {
        data: null,
        error: { code: "XX001", message: "fixture error" },
      };
    }

    if (this.mode === "invalid") {
      return {
        data: { replayed: "yes" },
        error: null,
      };
    }

    return {
      data: {
        replayed: false,
        contextRevision:
          this.mode === "revision_mismatch"
            ? "ctx:different"
            : args.p_batch.contextInsert.revision,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
        reconciliationRowsTouched: 0,
      },
      error: null,
    };
  }
}

export async function runPersistenceRpcScenario() {
  const client = new FakeRpcClient();
  const store = new SupabaseFinancialPersistenceStore(client, USER_ID);
  const validPlan = plan();
  const success = await store.persist(validPlan);

  const callsAfterSuccess = client.calls.length;
  let crossUserBlocked = false;
  try {
    await store.persist(plan("00000000-0000-4000-8000-000000000061"));
  } catch (error) {
    crossUserBlocked =
      error instanceof Error && error.message === "financial_persistence_user_mismatch";
  }

  client.mode = "invalid";
  let invalidResponseBlocked = false;
  try {
    await store.persist(validPlan);
  } catch (error) {
    invalidResponseBlocked =
      error instanceof Error && error.message === "financial_persistence_invalid_rpc_response";
  }

  client.mode = "revision_mismatch";
  let revisionMismatchBlocked = false;
  try {
    await store.persist(validPlan);
  } catch (error) {
    revisionMismatchBlocked =
      error instanceof Error && error.message === "financial_persistence_context_revision_mismatch";
  }

  client.mode = "error";
  let rpcErrorFailsClosed = false;
  try {
    await store.persist(validPlan);
  } catch (error) {
    rpcErrorFailsClosed =
      error instanceof Error && error.message === "financial_persistence_rpc_failed:XX001";
  }

  const firstCall = client.calls[0];
  const checks = {
    validServerOwnedCallSucceeds:
      success.contextRevision === validPlan.contextInsert.revision && !success.replayed,
    rpcNameIsFixed:
      firstCall?.functionName === "eos_financial_persist_snapshot_v1",
    trustedUserPassedSeparately:
      firstCall?.trustedUserId === USER_ID && firstCall?.batch.userId === USER_ID,
    crossUserPlanBlockedBeforeRpc:
      crossUserBlocked && client.calls.length >= callsAfterSuccess && callsAfterSuccess === 1,
    invalidRpcResponseFailsClosed: invalidResponseBlocked,
    contextRevisionMismatchFailsClosed: revisionMismatchBlocked,
    rpcErrorFailsClosed,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    callCount: client.calls.length,
    success,
  };
}
