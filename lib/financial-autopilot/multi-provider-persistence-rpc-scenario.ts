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
    private readonly response: (planFingerprint: string, revision: string | null) => {
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
    return this.response(
      args.p_batch.planFingerprint,
      args.p_batch.globalContextPlan?.revision ?? null,
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
  const successClient = new FakeRpcClient((planFingerprint, revision) => ({
    data: {
      replayed: false,
      planFingerprint,
      globalContextRevision: revision,
      providerScopesTouched: 2,
      ledgerRowsTouched: 2,
      ingestionRowsTouched: 2,
    },
    error: null,
  }));
  const store = new SupabaseMultiProviderPersistenceStore(successClient, USER_ID);
  const success = await store.persist(plan);

  const wrongFingerprintClient = new FakeRpcClient((_planFingerprint, revision) => ({
    data: {
      replayed: false,
      planFingerprint: "f".repeat(64),
      globalContextRevision: revision,
      providerScopesTouched: 2,
      ledgerRowsTouched: 2,
      ingestionRowsTouched: 2,
    },
    error: null,
  }));
  const wrongFingerprintBlocked = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        wrongFingerprintClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_plan_fingerprint_mismatch",
  );

  const wrongRevisionClient = new FakeRpcClient((planFingerprint) => ({
    data: {
      replayed: false,
      planFingerprint,
      globalContextRevision: `ctx:${"e".repeat(64)}`,
      providerScopesTouched: 2,
      ledgerRowsTouched: 2,
      ingestionRowsTouched: 2,
    },
    error: null,
  }));
  const wrongRevisionBlocked = await catchesCode(
    () =>
      new SupabaseMultiProviderPersistenceStore(
        wrongRevisionClient,
        USER_ID,
      ).persist(plan),
    "financial_multi_provider_persistence_context_revision_mismatch",
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
      providerScopesTouched: -1,
      ledgerRowsTouched: 0,
      ingestionRowsTouched: 0,
    });
  } catch (error) {
    malformedResponseBlocked =
      error instanceof Error &&
      error.message === "financial_multi_provider_persistence_invalid_rpc_response";
  }

  const checks = {
    exactServerRpcContractIsUsed:
      successClient.calls === 1 &&
      successClient.lastFunction === MULTI_PROVIDER_PERSISTENCE_RPC_V1_3 &&
      successClient.lastUserId === USER_ID,
    successfulResponseBindsPlanAndContext:
      success.planFingerprint === plan.planFingerprint &&
      success.globalContextRevision === plan.globalContextPlan?.revision,
    responsePlanSubstitutionFailsClosed: wrongFingerprintBlocked,
    responseContextSubstitutionFailsClosed: wrongRevisionBlocked,
    rpcFailureIsReducedToStableCode: rpcFailureSanitized,
    crossUserPlanNeverReachesRpc:
      crossUserBlockedBeforeRpc && successClient.calls === beforeCrossUserCalls,
    malformedCountersFailClosed: malformedResponseBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    success,
  };
}
