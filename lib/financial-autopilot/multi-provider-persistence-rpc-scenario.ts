import { buildMultiProviderGlobalContextCommitFromPlan } from "./global-context-commit";
import { runMultiProviderScopedPersistenceScenario } from "./multi-provider-scoped-persistence-scenario";
import {
  MULTI_PROVIDER_PERSISTENCE_RPC_V1_3,
  SupabaseMultiProviderPersistenceStore,
  parseMultiProviderPersistenceRpcResponse,
  type MultiProviderPersistenceRpcClient,
} from "./supabase-multi-provider-persistence-store";

const USER_ID = "00000000-0000-4000-8000-000000000170";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000171";

class FakeRpcClient implements MultiProviderPersistenceRpcClient {
  calls = 0;
  lastFunction: string | null = null;
  lastUserId: string | null = null;

  constructor(
    private readonly response: (
      planFingerprint: string,
      revision: string | null,
      commitFingerprint: string | null,
    ) => {
      data: unknown;
      error: { code?: string | null } | null;
    },
  ) {}

  async rpc(
    functionName: typeof MULTI_PROVIDER_PERSISTENCE_RPC_V1_3,
    args: Parameters<MultiProviderPersistenceRpcClient["rpc"]>[1],
  ) {
    this.calls += 1;
    this.lastFunction = functionName;
    this.lastUserId = args.p_usuario_id;
    const commit = buildMultiProviderGlobalContextCommitFromPlan({
      trustedUserId: args.p_usuario_id,
      plan: args.p_batch,
    });
    return this.response(
      args.p_batch.planFingerprint,
      args.p_batch.globalContextPlan?.revision ?? null,
      commit?.commitFingerprint ?? null,
    );
  }
}

function catchesCode(work: () => Promise<unknown>, code: string) {
  return work().then(
    () => false,
    (error) => error instanceof Error && error.message === code,
  );
}

export async function runMultiProviderPersistenceRpcScenario() {
  const plan = runMultiProviderScopedPersistenceScenario().healthy;
  const expectedCommit = buildMultiProviderGlobalContextCommitFromPlan({
    trustedUserId: USER_ID,
    plan,
  });
  const successClient = new FakeRpcClient(
    (planFingerprint, revision, commitFingerprint) => ({
      data: {
        replayed: false,
        planFingerprint,
        globalContextRevision: revision,
        globalContextCommitFingerprint: commitFingerprint,
        providerScopesTouched: 2,
        ledgerRowsTouched: 2,
        ingestionRowsTouched: 2,
      },
      error: null,
    }),
  );
  const store = new SupabaseMultiProviderPersistenceStore(successClient, USER_ID);
  const success = await store.persist(plan);

  const wrongFingerprintClient = new FakeRpcClient(
    (_planFingerprint, revision, commitFingerprint) => ({
      data: {
        replayed: false,
        planFingerprint: "f".repeat(64),
        globalContextRevision: revision,
        globalContextCommitFingerprint: commitFingerprint,
        providerScopesTouched: 2,
        ledgerRowsTouched: 2,
        ingestionRowsTouched: 2,
      },
      error: null,
    }),
  );
  const wrongFingerprintBlocked = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        wrongFingerprintClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_plan_fingerprint_mismatch",
  );

  const wrongRevisionClient = new FakeRpcClient(
    (planFingerprint, _revision, commitFingerprint) => ({
      data: {
        replayed: false,
        planFingerprint,
        globalContextRevision: `ctx:${"e".repeat(64)}`,
        globalContextCommitFingerprint: commitFingerprint,
        providerScopesTouched: 2,
        ledgerRowsTouched: 2,
        ingestionRowsTouched: 2,
      },
      error: null,
    }),
  );
  const wrongRevisionBlocked = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        wrongRevisionClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_context_revision_mismatch",
  );

  const wrongCommitClient = new FakeRpcClient(
    (planFingerprint, revision) => ({
      data: {
        replayed: false,
        planFingerprint,
        globalContextRevision: revision,
        globalContextCommitFingerprint: "d".repeat(64),
        providerScopesTouched: 2,
        ledgerRowsTouched: 2,
        ingestionRowsTouched: 2,
      },
      error: null,
    }),
  );
  const wrongCommitBlocked = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        wrongCommitClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_global_commit_mismatch",
  );

  const rpcFailureClient = new FakeRpcClient(() => ({
    data: null,
    error: { code: "P0001" },
  }));
  const rpcFailureSanitized = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        rpcFailureClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_rpc_failed:P0001",
  );

  const unsafeRpcFailureClient = new FakeRpcClient(() => ({
    data: null,
    error: { code: "P0001:raw-provider-detail" },
  }));
  const unsafeRpcFailureDetailIsNotExposed = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        unsafeRpcFailureClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_rpc_failed",
  );

  const crossUserPlan = { ...plan, userId: OTHER_USER_ID };
  const beforeCrossUserCalls = successClient.calls;
  const crossUserBlockedBeforeRpc = await catchesCode(
    () => store.persist(crossUserPlan),
    "financial_multi_provider_persistence_user_mismatch",
  );

  let malformedResponseBlocked = false;
  try {
    parseMultiProviderPersistenceRpcResponse({
      replayed: false,
      planFingerprint: plan.planFingerprint,
      globalContextRevision: plan.globalContextPlan?.revision ?? null,
      globalContextCommitFingerprint: expectedCommit?.commitFingerprint ?? null,
      providerScopesTouched: -1,
      ledgerRowsTouched: 0,
      ingestionRowsTouched: 0,
    });
  } catch (error) {
    malformedResponseBlocked =
      error instanceof Error &&
      error.message === "financial_multi_provider_persistence_invalid_rpc_response";
  }

  const missingCommitBlocked = (() => {
    try {
      parseMultiProviderPersistenceRpcResponse({
        replayed: false,
        planFingerprint: plan.planFingerprint,
        globalContextRevision: plan.globalContextPlan?.revision ?? null,
        providerScopesTouched: 0,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
      });
      return false;
    } catch (error) {
      return (
        error instanceof Error &&
        error.message ===
          "financial_multi_provider_persistence_invalid_rpc_response"
      );
    }
  })();

  const replayWithTouchedRowsBlocked = (() => {
    try {
      parseMultiProviderPersistenceRpcResponse({
        replayed: true,
        planFingerprint: plan.planFingerprint,
        globalContextRevision: plan.globalContextPlan?.revision ?? null,
        globalContextCommitFingerprint: expectedCommit?.commitFingerprint ?? null,
        providerScopesTouched: 1,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
      });
      return false;
    } catch (error) {
      return (
        error instanceof Error &&
        error.message ===
          "financial_multi_provider_persistence_invalid_rpc_response"
      );
    }
  })();

  const contextWithoutCommitBlocked = (() => {
    try {
      parseMultiProviderPersistenceRpcResponse({
        replayed: false,
        planFingerprint: plan.planFingerprint,
        globalContextRevision: plan.globalContextPlan?.revision ?? null,
        globalContextCommitFingerprint: null,
        providerScopesTouched: 0,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
      });
      return false;
    } catch (error) {
      return (
        error instanceof Error &&
        error.message ===
          "financial_multi_provider_persistence_invalid_rpc_response"
      );
    }
  })();

  const oversizedCounterClient = new FakeRpcClient(
    (planFingerprint, revision, commitFingerprint) => ({
      data: {
        replayed: false,
        planFingerprint,
        globalContextRevision: revision,
        globalContextCommitFingerprint: commitFingerprint,
        providerScopesTouched: plan.providerPlans.length + 1,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
      },
      error: null,
    }),
  );
  const oversizedCounterBlocked = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        oversizedCounterClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_rpc_counter_mismatch",
  );

  const checks = {
    exactServerRpcContractIsUsed:
      successClient.calls === 1 &&
      successClient.lastFunction === MULTI_PROVIDER_PERSISTENCE_RPC_V1_3 &&
      successClient.lastUserId === USER_ID,
    successfulResponseBindsPlanContextAndCommit:
      success.planFingerprint === plan.planFingerprint &&
      success.globalContextRevision === plan.globalContextPlan?.revision &&
      success.globalContextCommitFingerprint === expectedCommit?.commitFingerprint,
    responsePlanSubstitutionFailsClosed: wrongFingerprintBlocked,
    responseContextSubstitutionFailsClosed: wrongRevisionBlocked,
    responseGlobalCommitSubstitutionFailsClosed: wrongCommitBlocked,
    rpcFailureIsReducedToStableCode: rpcFailureSanitized,
    unsafeRpcFailureDetailIsNotExposed,
    crossUserPlanNeverReachesRpc:
      crossUserBlockedBeforeRpc && successClient.calls === beforeCrossUserCalls,
    malformedCountersFailClosed: malformedResponseBlocked,
    missingGlobalCommitFieldFailsClosed: missingCommitBlocked,
    replayCannotClaimTouchedRows: replayWithTouchedRowsBlocked,
    contextRequiresMatchingCommitIdentity: contextWithoutCommitBlocked,
    countersCannotExceedSubmittedRows: oversizedCounterBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    success,
  };
}
