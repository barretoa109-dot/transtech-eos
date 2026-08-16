import {
  sha256FinancialFingerprint,
  stableFinancialFingerprintMaterial,
} from "./persistence-fingerprint";
import type { MultiProviderPersistenceManifest } from "./multi-provider-persistence-manifest";
import type {
  MultiProviderGlobalContextPlan,
  MultiProviderScopedPersistencePlan,
  MultiProviderScopedProviderPlan,
} from "./multi-provider-scoped-persistence";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CONTEXT_REVISION = /^ctx:[a-f0-9]{64}$/;

export interface MultiProviderPersistenceResult {
  replayed: boolean;
  planFingerprint: string;
  globalContextRevision: string | null;
  providerScopesTouched: number;
  ledgerRowsTouched: number;
  ingestionRowsTouched: number;
}

export interface MultiProviderPersistenceStore {
  persist(
    plan: MultiProviderScopedPersistencePlan,
  ): Promise<MultiProviderPersistenceResult>;
}

type StoreState = {
  plans: Map<string, string>;
  providerScopes: Map<string, string>;
  connections: Map<string, string>;
  accounts: Map<string, string>;
  ingestion: Map<string, string>;
  ledger: Map<string, string>;
  globalContexts: Map<string, string>;
};

function emptyState(): StoreState {
  return {
    plans: new Map(),
    providerScopes: new Map(),
    connections: new Map(),
    accounts: new Map(),
    ingestion: new Map(),
    ledger: new Map(),
    globalContexts: new Map(),
  };
}

function cloneState(state: StoreState): StoreState {
  return {
    plans: new Map(state.plans),
    providerScopes: new Map(state.providerScopes),
    connections: new Map(state.connections),
    accounts: new Map(state.accounts),
    ingestion: new Map(state.ingestion),
    ledger: new Map(state.ledger),
    globalContexts: new Map(state.globalContexts),
  };
}

function immutableInsert(
  map: Map<string, string>,
  key: string,
  value: unknown,
  mismatchCode: string,
) {
  const serialized = stableFinancialFingerprintMaterial(value);
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, serialized);
    return true;
  }
  if (current !== serialized) throw new Error(mismatchCode);
  return false;
}

function mutableUpsert(map: Map<string, string>, key: string, value: unknown) {
  const serialized = stableFinancialFingerprintMaterial(value);
  const current = map.get(key);
  if (current === serialized) return false;
  map.set(key, serialized);
  return true;
}

function providerPlanFingerprint(plan: MultiProviderScopedProviderPlan) {
  return sha256FinancialFingerprint({
    contract: "multi-provider-scoped-provider-plan-v1",
    providerKey: plan.providerKey,
    scopeFingerprint: plan.scopeFingerprint,
    snapshotFingerprint: plan.snapshotFingerprint,
    connectionUpserts: plan.connectionUpserts,
    accountUpserts: plan.accountUpserts,
    ingestionEventUpserts: plan.ingestionEventUpserts,
    ledgerUpserts: plan.ledgerUpserts,
  });
}

function manifestFingerprint(manifest: MultiProviderPersistenceManifest) {
  return sha256FinancialFingerprint({
    contract: "multi-provider-persistence-manifest-v1",
    trustedUserId: manifest.trustedUserId,
    providerScopes: manifest.providerScopes.map((scope) => ({
      providerKey: scope.providerKey,
      scopeFingerprint: scope.scopeFingerprint,
    })),
    analysisFingerprint: manifest.analysisFingerprint,
    globalCoverageFingerprint: manifest.globalCoverageFingerprint,
    sourceOrchestrationFingerprint: manifest.sourceOrchestrationFingerprint,
    globalResultFingerprint: manifest.globalResultFingerprint,
    globalContextEligible: manifest.globalContextEligible,
  });
}

function globalContextFingerprint(context: MultiProviderGlobalContextPlan) {
  return sha256FinancialFingerprint({
    contract: "multi-provider-global-financial-context-v1",
    trustedUserId: context.userId,
    manifestFingerprint: context.manifestFingerprint,
    analysisFingerprint: context.analysisFingerprint,
    globalCoverageFingerprint: context.globalCoverageFingerprint,
    sourceOrchestrationFingerprint: context.sourceOrchestrationFingerprint,
    globalResultFingerprint: context.globalResultFingerprint,
    currency: context.currency,
    status: context.status,
    horizonUntil: context.horizonUntil,
    horizonReason: context.horizonReason,
    liquidityUsableMinor: context.liquidityUsableMinor,
    protectedCommitmentsMinor: context.protectedCommitmentsMinor,
    essentialSpendExpectedMinor: context.essentialSpendExpectedMinor,
    protectedReserveMinor: context.protectedReserveMinor,
    criticalProvisionsMinor: context.criticalProvisionsMinor,
    confirmedIncomeMinor: context.confirmedIncomeMinor,
    uncertaintyBufferMinor: context.uncertaintyBufferMinor,
    availableRealSafeMinor: context.availableRealSafeMinor,
    minimumProjectedCashMinor: context.minimumProjectedCashMinor,
    minimumProjectedCashAt: context.minimumProjectedCashAt,
    confidence: context.confidence,
    sourcesFresh: context.sourcesFresh,
    criticalSourcesComplete: context.criticalSourcesComplete,
    criticalObligationsComplete: context.criticalObligationsComplete,
    firstForecastRisk: context.firstForecastRisk,
    generatedAt: context.generatedAt,
    validUntil: context.validUntil,
    explanationRefs: context.explanationRefs,
  });
}

function scopedPlanFingerprint(plan: MultiProviderScopedPersistencePlan) {
  return sha256FinancialFingerprint({
    contract: "multi-provider-scoped-persistence-plan-v1",
    trustedUserId: plan.userId,
    manifestFingerprint: plan.manifest.manifestFingerprint,
    providerPlans: plan.providerPlans.map((providerPlan) => ({
      providerKey: providerPlan.providerKey,
      scopeFingerprint: providerPlan.scopeFingerprint,
      providerPlanFingerprint: providerPlan.providerPlanFingerprint,
    })),
    globalContextRevision: plan.globalContextPlan?.revision ?? null,
  });
}

function assertProviderPlan(
  plan: MultiProviderScopedProviderPlan,
  trustedUserId: string,
) {
  if (
    !plan.providerKey ||
    plan.providerKey.trim() !== plan.providerKey ||
    !SHA256_HEX.test(plan.scopeFingerprint) ||
    !SHA256_HEX.test(plan.snapshotFingerprint) ||
    !SHA256_HEX.test(plan.providerPlanFingerprint) ||
    providerPlanFingerprint(plan) !== plan.providerPlanFingerprint
  ) {
    throw new Error("financial_multi_provider_store_invalid_provider_plan_identity");
  }

  const connectionKeys = new Set<string>();
  for (const row of plan.connectionUpserts) {
    if (row.userId !== trustedUserId || row.providerKey !== plan.providerKey) {
      throw new Error("financial_multi_provider_store_provider_scope_mismatch");
    }
    if (connectionKeys.has(row.connectionKey)) {
      throw new Error("financial_multi_provider_store_duplicate_connection_identity");
    }
    connectionKeys.add(row.connectionKey);
  }

  const accountKeys = new Set<string>();
  for (const row of plan.accountUpserts) {
    if (row.userId !== trustedUserId) {
      throw new Error("financial_multi_provider_store_user_mismatch");
    }
    if (!connectionKeys.has(row.connectionKey)) {
      throw new Error("financial_multi_provider_store_account_connection_mismatch");
    }
    const key = `${row.connectionKey}|${row.externalAccountId}`;
    if (accountKeys.has(key)) {
      throw new Error("financial_multi_provider_store_duplicate_account_identity");
    }
    accountKeys.add(key);
  }

  const ingestionKeys = new Set<string>();
  for (const row of plan.ingestionEventUpserts) {
    if (row.userId !== trustedUserId || row.providerKey !== plan.providerKey) {
      throw new Error("financial_multi_provider_store_provider_scope_mismatch");
    }
    const accountKey = `${row.connectionKey}|${row.accountExternalId}`;
    if (!accountKeys.has(accountKey)) {
      throw new Error("financial_multi_provider_store_ingestion_account_mismatch");
    }
    const key = `${accountKey}|${row.sourceEventKey}`;
    if (ingestionKeys.has(key)) {
      throw new Error("financial_multi_provider_store_duplicate_ingestion_identity");
    }
    ingestionKeys.add(key);
  }

  const ledgerKeys = new Set<string>();
  for (const row of plan.ledgerUpserts) {
    if (row.userId !== trustedUserId || row.providerKey !== plan.providerKey) {
      throw new Error("financial_multi_provider_store_provider_scope_mismatch");
    }
    const accountKey = `${row.connectionKey}|${row.accountExternalId}`;
    if (!accountKeys.has(accountKey)) {
      throw new Error("financial_multi_provider_store_ledger_account_mismatch");
    }
    if (!ingestionKeys.has(`${accountKey}|${row.sourceEventKey}`)) {
      throw new Error("financial_multi_provider_store_ledger_ingestion_mismatch");
    }
    if (ledgerKeys.has(row.canonicalKey)) {
      throw new Error("financial_multi_provider_store_duplicate_ledger_identity");
    }
    ledgerKeys.add(row.canonicalKey);
  }
}

function assertGlobalContext(
  context: MultiProviderGlobalContextPlan,
  plan: MultiProviderScopedPersistencePlan,
  trustedUserId: string,
) {
  const expectedFingerprint = globalContextFingerprint(context);
  if (
    context.userId !== trustedUserId ||
    !SHA256_HEX.test(context.sourceFingerprint) ||
    !CONTEXT_REVISION.test(context.revision) ||
    context.sourceFingerprint !== expectedFingerprint ||
    context.revision !== `ctx:${expectedFingerprint}` ||
    context.manifestFingerprint !== plan.manifest.manifestFingerprint ||
    context.analysisFingerprint !== plan.manifest.analysisFingerprint ||
    context.globalCoverageFingerprint !== plan.manifest.globalCoverageFingerprint ||
    context.sourceOrchestrationFingerprint !==
      plan.manifest.sourceOrchestrationFingerprint ||
    context.globalResultFingerprint !== plan.manifest.globalResultFingerprint
  ) {
    throw new Error("financial_multi_provider_store_invalid_global_context_identity");
  }
}

function assertManifest(
  manifest: MultiProviderPersistenceManifest,
  trustedUserId: string,
) {
  if (
    manifest.version !== "multi-provider-persistence-manifest-v1" ||
    manifest.trustedUserId !== trustedUserId ||
    !SHA256_HEX.test(manifest.manifestFingerprint) ||
    !SHA256_HEX.test(manifest.analysisFingerprint) ||
    !SHA256_HEX.test(manifest.globalResultFingerprint) ||
    (manifest.globalCoverageFingerprint !== null &&
      !SHA256_HEX.test(manifest.globalCoverageFingerprint)) ||
    (manifest.sourceOrchestrationFingerprint !== null &&
      !SHA256_HEX.test(manifest.sourceOrchestrationFingerprint)) ||
    manifestFingerprint(manifest) !== manifest.manifestFingerprint
  ) {
    throw new Error("financial_multi_provider_store_invalid_manifest_identity");
  }

  if (
    manifest.globalContextEligible &&
    (!manifest.globalCoverageFingerprint || !manifest.sourceOrchestrationFingerprint)
  ) {
    throw new Error("financial_multi_provider_store_invalid_global_eligibility");
  }

  const scopeFingerprints = new Set<string>();
  for (const scope of manifest.providerScopes) {
    if (
      !scope.providerKey ||
      scope.providerKey.trim() !== scope.providerKey ||
      !SHA256_HEX.test(scope.scopeFingerprint) ||
      !SHA256_HEX.test(scope.snapshotFingerprint) ||
      scopeFingerprints.has(scope.scopeFingerprint)
    ) {
      throw new Error("financial_multi_provider_store_invalid_manifest_scope");
    }
    scopeFingerprints.add(scope.scopeFingerprint);
  }
}

function assertPlan(
  plan: MultiProviderScopedPersistencePlan,
  trustedUserId: string,
) {
  if (
    plan.version !== "multi-provider-scoped-persistence-plan-v1" ||
    plan.userId !== trustedUserId ||
    !SHA256_HEX.test(plan.planFingerprint)
  ) {
    throw new Error("financial_multi_provider_store_user_or_version_mismatch");
  }

  assertManifest(plan.manifest, trustedUserId);

  if (
    plan.providerPlans.length !== plan.manifest.providerScopes.length ||
    new Set(plan.providerPlans.map((row) => row.scopeFingerprint)).size !==
      plan.providerPlans.length ||
    new Set(plan.providerPlans.map((row) => row.providerPlanFingerprint)).size !==
      plan.providerPlans.length
  ) {
    throw new Error("financial_multi_provider_store_invalid_provider_scope_set");
  }

  for (const providerPlan of plan.providerPlans) {
    assertProviderPlan(providerPlan, trustedUserId);
    const manifestScope = plan.manifest.providerScopes.find(
      (row) => row.scopeFingerprint === providerPlan.scopeFingerprint,
    );
    if (
      !manifestScope ||
      manifestScope.providerKey !== providerPlan.providerKey ||
      manifestScope.snapshotFingerprint !== providerPlan.snapshotFingerprint
    ) {
      throw new Error("financial_multi_provider_store_manifest_scope_mismatch");
    }
  }

  if (plan.globalContextPlan) {
    if (!plan.manifest.globalContextEligible) {
      throw new Error("financial_multi_provider_store_unexpected_global_context");
    }
    assertGlobalContext(plan.globalContextPlan, plan, trustedUserId);
  } else if (plan.manifest.globalContextEligible) {
    throw new Error("financial_multi_provider_store_missing_global_context");
  }

  if (scopedPlanFingerprint(plan) !== plan.planFingerprint) {
    throw new Error("financial_multi_provider_store_invalid_plan_fingerprint");
  }
}

/**
 * Preview-only transactional emulator for the future multi-provider RPC.
 *
 * Every mutation is staged in cloned maps. A replay conflict in the last
 * provider therefore leaves earlier provider rows untouched, mirroring the
 * all-or-nothing transaction semantics required from PostgreSQL/Supabase.
 */
export class InMemoryMultiProviderPersistenceStore
  implements MultiProviderPersistenceStore
{
  private state = emptyState();

  constructor(private readonly trustedUserId: string) {
    if (!trustedUserId) {
      throw new Error("financial_multi_provider_store_missing_trusted_user");
    }
  }

  async persist(
    plan: MultiProviderScopedPersistencePlan,
  ): Promise<MultiProviderPersistenceResult> {
    assertPlan(plan, this.trustedUserId);

    const planKey = `${this.trustedUserId}|${plan.planFingerprint}`;
    const serializedPlan = stableFinancialFingerprintMaterial(plan);
    const existingPlan = this.state.plans.get(planKey);
    if (existingPlan !== undefined) {
      if (existingPlan !== serializedPlan) {
        throw new Error("financial_multi_provider_plan_replay_mismatch");
      }
      return {
        replayed: true,
        planFingerprint: plan.planFingerprint,
        globalContextRevision: plan.globalContextPlan?.revision ?? null,
        providerScopesTouched: 0,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
      };
    }

    const staged = cloneState(this.state);
    let providerScopesTouched = 0;
    let ledgerRowsTouched = 0;
    let ingestionRowsTouched = 0;

    for (const providerPlan of plan.providerPlans) {
      const scopeInserted = immutableInsert(
        staged.providerScopes,
        `${this.trustedUserId}|${providerPlan.providerKey}|${providerPlan.scopeFingerprint}`,
        {
          snapshotFingerprint: providerPlan.snapshotFingerprint,
          providerPlanFingerprint: providerPlan.providerPlanFingerprint,
        },
        "financial_multi_provider_scope_replay_mismatch",
      );
      if (scopeInserted) providerScopesTouched += 1;

      for (const row of providerPlan.connectionUpserts) {
        mutableUpsert(
          staged.connections,
          `${row.userId}|${row.providerKey}|${row.connectionKey}`,
          row,
        );
      }

      for (const row of providerPlan.accountUpserts) {
        mutableUpsert(
          staged.accounts,
          `${row.userId}|${providerPlan.providerKey}|${row.connectionKey}|${row.externalAccountId}`,
          row,
        );
      }

      for (const row of providerPlan.ingestionEventUpserts) {
        const inserted = immutableInsert(
          staged.ingestion,
          `${row.userId}|${row.providerKey}|${row.connectionKey}|${row.externalEventId}`,
          row,
          "financial_multi_provider_ingestion_replay_mismatch",
        );
        if (inserted) ingestionRowsTouched += 1;
      }

      for (const row of providerPlan.ledgerUpserts) {
        if (
          mutableUpsert(
            staged.ledger,
            `${row.userId}|${row.providerKey}|${row.canonicalKey}`,
            row,
          )
        ) {
          ledgerRowsTouched += 1;
        }
      }
    }

    if (plan.globalContextPlan) {
      immutableInsert(
        staged.globalContexts,
        `${this.trustedUserId}|${plan.globalContextPlan.sourceFingerprint}`,
        plan.globalContextPlan,
        "financial_multi_provider_global_context_replay_mismatch",
      );
    }

    staged.plans.set(planKey, serializedPlan);
    this.state = staged;

    return {
      replayed: false,
      planFingerprint: plan.planFingerprint,
      globalContextRevision: plan.globalContextPlan?.revision ?? null,
      providerScopesTouched,
      ledgerRowsTouched,
      ingestionRowsTouched,
    };
  }

  snapshotCounts() {
    return {
      plans: this.state.plans.size,
      providerScopes: this.state.providerScopes.size,
      connections: this.state.connections.size,
      accounts: this.state.accounts.size,
      ingestionEvents: this.state.ingestion.size,
      ledgerRows: this.state.ledger.size,
      globalContexts: this.state.globalContexts.size,
    };
  }
}
