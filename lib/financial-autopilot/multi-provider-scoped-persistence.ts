import type {
  TrustedGlobalSourceClosure,
  TrustedScopedSourceBundle,
} from "./global-source-coverage";
import {
  buildMultiProviderPersistenceManifest,
  type MultiProviderPersistenceManifest,
} from "./multi-provider-persistence-manifest";
import {
  financialLedgerCanonicalKey,
  sha256FinancialFingerprint,
  type FinancialAccountUpsert,
  type FinancialConnectionUpsert,
  type FinancialIngestionEventUpsert,
  type FinancialLedgerUpsert,
} from "./persistence";
import { financialAccountSourceCoverageRef } from "./source-coverage";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";
import type { GlobalZeroEntryAutopilotResult } from "./zero-entry";

export interface MultiProviderScopedProviderPlan {
  providerKey: string;
  fetchedAt: string;
  snapshotFingerprint: string;
  scopeFingerprint: string;
  connectionUpserts: FinancialConnectionUpsert[];
  accountUpserts: FinancialAccountUpsert[];
  ingestionEventUpserts: FinancialIngestionEventUpsert[];
  ledgerUpserts: FinancialLedgerUpsert[];
  providerPlanFingerprint: string;
}

export interface MultiProviderGlobalContextPlan {
  userId: string;
  revision: string;
  sourceFingerprint: string;
  manifestFingerprint: string;
  analysisFingerprint: string;
  globalCoverageFingerprint: string;
  sourceOrchestrationFingerprint: string;
  globalResultFingerprint: string;
  currency: string;
  status: GlobalZeroEntryAutopilotResult["context"]["available"]["status"];
  horizonUntil: string;
  horizonReason: GlobalZeroEntryAutopilotResult["primaryHorizon"]["reason"];
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
  confidence: GlobalZeroEntryAutopilotResult["confidence"];
  sourcesFresh: boolean;
  criticalSourcesComplete: boolean;
  criticalObligationsComplete: boolean;
  firstForecastRisk: GlobalZeroEntryAutopilotResult["horizons"]["firstRisk"];
  generatedAt: string;
  validUntil: string;
  explanationRefs: string[];
}

export interface MultiProviderScopedPersistencePlan {
  version: "multi-provider-scoped-persistence-plan-v1";
  userId: string;
  manifest: MultiProviderPersistenceManifest;
  providerPlans: MultiProviderScopedProviderPlan[];
  /** Null when trusted global structural closure is incomplete. Raw provider ingestion may still proceed. */
  globalContextPlan: MultiProviderGlobalContextPlan | null;
  planFingerprint: string;
}

function normalizeProviderKey(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new Error("financial_multi_provider_persistence_invalid_provider_key");
  }
  return normalized;
}

function parseTime(value: string, code: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(code);
  return time;
}

function canonicalIso(value: string, code: string) {
  return new Date(parseTime(value, code)).toISOString();
}

function earliestIso(values: Array<string | null | undefined>, fallback: string) {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time)[0];
  return valid ? new Date(valid.time).toISOString() : canonicalIso(fallback, "financial_multi_provider_persistence_invalid_valid_until");
}

function connectionType(providerKey: string): FinancialConnectionUpsert["connectionType"] {
  if (providerKey.startsWith("csv_")) return "csv_import";
  if (providerKey.startsWith("mock_")) return "mock";
  return "connector";
}

function connectionHealth(
  accounts: FinancialAccount[],
  asOf: string,
): Pick<FinancialConnectionUpsert, "status" | "health" | "freshUntil"> {
  const asOfMs = parseTime(asOf, "financial_multi_provider_persistence_invalid_fetched_at");
  const freshTimes = accounts
    .map((account) =>
      account.freshUntil ? new Date(account.freshUntil).getTime() : Number.NaN,
    )
    .filter(Number.isFinite);
  const earliestFresh = freshTimes.length > 0 ? Math.min(...freshTimes) : Number.NaN;
  const allFresh =
    accounts.length > 0 &&
    freshTimes.length === accounts.length &&
    Number.isFinite(earliestFresh) &&
    earliestFresh >= asOfMs;

  return {
    status: allFresh ? "active" : "stale",
    health: allFresh ? "healthy" : "stale",
    freshUntil: Number.isFinite(earliestFresh)
      ? new Date(earliestFresh).toISOString()
      : null,
  };
}

function providerScopeMaterial(input: {
  trustedUserId: string;
  snapshot: FinancialConnectorSnapshot;
}) {
  const providerKey = normalizeProviderKey(input.snapshot.providerKey);
  const fetchedAt = canonicalIso(
    input.snapshot.fetchedAt,
    "financial_multi_provider_persistence_invalid_fetched_at",
  );
  const accountsById = new Map(
    input.snapshot.accounts.map((account) => [account.id, account]),
  );

  for (const account of input.snapshot.accounts) {
    if (account.userId !== input.trustedUserId) {
      throw new Error("financial_multi_provider_persistence_account_owner_mismatch");
    }
  }
  for (const entry of input.snapshot.ledgerEntries) {
    if (entry.userId !== input.trustedUserId) {
      throw new Error("financial_multi_provider_persistence_ledger_owner_mismatch");
    }
    if (!accountsById.has(entry.accountId)) {
      throw new Error("financial_multi_provider_persistence_ledger_scope_mismatch");
    }
  }

  const accountMaterial = input.snapshot.accounts
    .map((account) => ({
      sourceRef: financialAccountSourceCoverageRef({
        userId: input.trustedUserId,
        providerKey,
        account,
      }),
      account,
    }))
    .sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));

  const canonicalByLedgerId = new Map<string, string>();
  const ledgerMaterial = input.snapshot.ledgerEntries
    .map((entry) => {
      const account = accountsById.get(entry.accountId);
      if (!account) {
        throw new Error("financial_multi_provider_persistence_ledger_scope_mismatch");
      }
      const canonicalKey = financialLedgerCanonicalKey(entry, {
        providerKey,
        connectionKey: account.connectionId,
        externalAccountId: account.externalAccountId,
      });
      canonicalByLedgerId.set(entry.id, canonicalKey);
      return { canonicalKey, entry };
    })
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

  const snapshotFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-snapshot-persistence-material-v1",
    providerKey,
    fetchedAt,
    accounts: accountMaterial,
    ledgerEntries: ledgerMaterial,
  });
  const accountSourceRefs = accountMaterial.map((row) => row.sourceRef);
  const ledgerCanonicalKeys = ledgerMaterial.map((row) => row.canonicalKey);
  const scopeFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-persistence-scope-v1",
    providerKey,
    snapshotFingerprint,
    accountSourceRefs,
    ledgerCanonicalKeys,
  });

  return {
    providerKey,
    fetchedAt,
    accountsById,
    canonicalByLedgerId,
    accountSourceRefs,
    ledgerCanonicalKeys,
    snapshotFingerprint,
    scopeFingerprint,
  };
}

function buildProviderPlan(input: {
  trustedUserId: string;
  bundle: TrustedScopedSourceBundle;
  expectedScopeFingerprint: string;
  expectedSnapshotFingerprint: string;
}) {
  const { snapshot } = input.bundle;
  const material = providerScopeMaterial({
    trustedUserId: input.trustedUserId,
    snapshot,
  });

  if (
    material.scopeFingerprint !== input.expectedScopeFingerprint ||
    material.snapshotFingerprint !== input.expectedSnapshotFingerprint
  ) {
    throw new Error("financial_multi_provider_persistence_manifest_scope_mismatch");
  }

  const connectionGroups = new Map<string, FinancialAccount[]>();
  for (const account of snapshot.accounts) {
    const group = connectionGroups.get(account.connectionId) ?? [];
    group.push(account);
    connectionGroups.set(account.connectionId, group);
  }

  const connectionUpserts = [...connectionGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([connectionKey, accounts]) => {
      const health = connectionHealth(accounts, material.fetchedAt);
      return {
        userId: input.trustedUserId,
        providerKey: material.providerKey,
        connectionKey,
        connectionType: connectionType(material.providerKey),
        country: "PY",
        status: health.status,
        lastSyncAt: material.fetchedAt,
        lastSuccessAt: material.fetchedAt,
        freshUntil: health.freshUntil,
        health: health.health,
      } satisfies FinancialConnectionUpsert;
    });

  const accountUpserts = [...snapshot.accounts]
    .sort((a, b) =>
      `${a.connectionId}:${a.externalAccountId}`.localeCompare(
        `${b.connectionId}:${b.externalAccountId}`,
      ),
    )
    .map((account) => {
      const freshUntilMs = account.freshUntil
        ? new Date(account.freshUntil).getTime()
        : Number.NaN;
      const fetchedAtMs = new Date(material.fetchedAt).getTime();
      return {
        userId: input.trustedUserId,
        connectionKey: account.connectionId,
        externalAccountId: account.externalAccountId,
        accountType: account.type,
        institutionName: account.institutionName,
        displayName: account.displayName,
        currency: account.currency,
        ownership: account.ownership,
        availableBalanceMinor: account.availableBalanceMinor,
        ledgerBalanceMinor: account.ledgerBalanceMinor,
        balanceAsOf: account.balanceAsOf,
        freshUntil: account.freshUntil,
        status:
          Number.isFinite(freshUntilMs) && freshUntilMs >= fetchedAtMs
            ? "active"
            : "stale",
      } satisfies FinancialAccountUpsert;
    });

  const ingestionEventUpserts = [...snapshot.ledgerEntries]
    .map((entry) => {
      const account = material.accountsById.get(entry.accountId);
      if (!account) {
        throw new Error("financial_multi_provider_persistence_ledger_scope_mismatch");
      }
      const sourceFingerprint = sha256FinancialFingerprint({
        providerKey: material.providerKey,
        connectionKey: account.connectionId,
        accountExternalId: account.externalAccountId,
        sourceEventId: entry.sourceEventId,
        status: entry.status,
        externalTransactionId: entry.externalTransactionId,
        occurredAt: entry.occurredAt,
        postedAt: entry.postedAt,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        direction: entry.direction,
      });
      return {
        userId: input.trustedUserId,
        providerKey: material.providerKey,
        connectionKey: account.connectionId,
        accountExternalId: account.externalAccountId,
        sourceEventKey: entry.sourceEventId,
        externalEventId: entry.sourceEventId,
        eventType: "transaction_snapshot",
        providerStatus: entry.status,
        occurredAt: entry.occurredAt,
        receivedAt: material.fetchedAt,
        sourceFingerprint,
        payloadHash: sha256FinancialFingerprint(entry),
      } satisfies FinancialIngestionEventUpsert;
    })
    .sort((a, b) =>
      `${a.connectionKey}:${a.accountExternalId}:${a.sourceEventKey}`.localeCompare(
        `${b.connectionKey}:${b.accountExternalId}:${b.sourceEventKey}`,
      ),
    );

  const ledgerUpserts = [...snapshot.ledgerEntries]
    .map((entry) => {
      const account = material.accountsById.get(entry.accountId);
      if (!account) {
        throw new Error("financial_multi_provider_persistence_ledger_scope_mismatch");
      }
      const canonicalKey = material.canonicalByLedgerId.get(entry.id);
      if (!canonicalKey) {
        throw new Error("financial_multi_provider_persistence_missing_ledger_identity");
      }
      return {
        userId: input.trustedUserId,
        providerKey: material.providerKey,
        connectionKey: account.connectionId,
        accountExternalId: account.externalAccountId,
        sourceEventKey: entry.sourceEventId,
        canonicalKey,
        externalTransactionId: entry.externalTransactionId,
        transactionType: entry.type,
        direction: entry.direction,
        status: entry.status,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        occurredAt: entry.occurredAt,
        postedAt: entry.postedAt,
        descriptionRaw: entry.descriptionRaw,
        merchantNormalized: entry.merchantNormalized,
        category: entry.category,
        subcategory: entry.subcategory,
        counterpartyRef: entry.counterpartyRef,
        recurrenceKey: entry.recurrenceId,
        reversalCanonicalKey: entry.reversalOf
          ? material.canonicalByLedgerId.get(entry.reversalOf) ?? null
          : null,
        confidence: entry.confidence,
        provenance: entry.provenance,
      } satisfies FinancialLedgerUpsert;
    })
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

  const providerPlanFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-scoped-provider-plan-v1",
    providerKey: material.providerKey,
    scopeFingerprint: material.scopeFingerprint,
    snapshotFingerprint: material.snapshotFingerprint,
    connectionUpserts,
    accountUpserts,
    ingestionEventUpserts,
    ledgerUpserts,
  });

  return {
    providerKey: material.providerKey,
    fetchedAt: material.fetchedAt,
    snapshotFingerprint: material.snapshotFingerprint,
    scopeFingerprint: material.scopeFingerprint,
    connectionUpserts,
    accountUpserts,
    ingestionEventUpserts,
    ledgerUpserts,
    providerPlanFingerprint,
  } satisfies MultiProviderScopedProviderPlan;
}

function buildGlobalContextPlan(input: {
  trustedUserId: string;
  bundles: TrustedScopedSourceBundle[];
  manifest: MultiProviderPersistenceManifest;
  result: GlobalZeroEntryAutopilotResult;
  nowIso: string;
}): MultiProviderGlobalContextPlan | null {
  if (!input.manifest.globalContextEligible) return null;
  if (
    !input.manifest.globalCoverageFingerprint ||
    !input.manifest.sourceOrchestrationFingerprint ||
    input.result.sourceCoverage.inventoryFingerprint !==
      input.manifest.globalCoverageFingerprint ||
    input.result.sourceOrchestrationFingerprint !==
      input.manifest.sourceOrchestrationFingerprint
  ) {
    throw new Error("financial_multi_provider_persistence_global_context_mismatch");
  }

  const generatedAt = canonicalIso(
    input.nowIso,
    "financial_multi_provider_persistence_invalid_generated_at",
  );
  const authoritativeFreshUntil = input.bundles.flatMap((bundle) =>
    bundle.snapshot.accounts
      .filter(
        (account) => account.ownership === "own" || account.ownership === "joint",
      )
      .map((account) => account.freshUntil),
  );
  const validUntil = earliestIso(
    [
      input.result.primaryHorizon.until,
      input.result.sourceCoverage.coverageValidUntil,
      ...authoritativeFreshUntil,
    ],
    input.result.primaryHorizon.until,
  );
  const explanationRefs = [
    `multi-provider-manifest:${input.manifest.manifestFingerprint}`,
    `global-source-coverage:${input.manifest.globalCoverageFingerprint}`,
    `global-source-orchestration:${input.manifest.sourceOrchestrationFingerprint}`,
    `multi-provider-analysis:${input.manifest.analysisFingerprint}`,
    `multi-provider-result:${input.manifest.globalResultFingerprint}`,
  ].sort();

  const sourceFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-global-financial-context-v1",
    trustedUserId: input.trustedUserId,
    manifestFingerprint: input.manifest.manifestFingerprint,
    analysisFingerprint: input.manifest.analysisFingerprint,
    globalCoverageFingerprint: input.manifest.globalCoverageFingerprint,
    sourceOrchestrationFingerprint: input.manifest.sourceOrchestrationFingerprint,
    globalResultFingerprint: input.manifest.globalResultFingerprint,
    currency: input.result.context.currency,
    status: input.result.context.available.status,
    horizonUntil: input.result.context.horizonUntil,
    horizonReason: input.result.primaryHorizon.reason,
    liquidityUsableMinor: input.result.context.liquidityUsableMinor,
    protectedCommitmentsMinor: input.result.context.protectedCommitmentsMinor,
    essentialSpendExpectedMinor: input.result.essentialSpend.expectedMinor,
    protectedReserveMinor: input.result.resolvedInputs.protectedReserveMinor,
    criticalProvisionsMinor: input.result.resolvedInputs.criticalProvisionsMinor,
    confirmedIncomeMinor: input.result.resolvedInputs.confirmedIncomeMinor,
    uncertaintyBufferMinor: input.result.resolvedInputs.uncertaintyBufferMinor,
    availableRealSafeMinor: input.result.context.available.availableRealSafeMinor,
    minimumProjectedCashMinor: input.result.context.minimumProjectedCashMinor,
    minimumProjectedCashAt: input.result.context.minimumProjectedCashAt,
    confidence: input.result.confidence,
    sourcesFresh: input.result.context.sourcesFresh,
    criticalSourcesComplete: input.result.resolvedInputs.criticalSourcesComplete,
    criticalObligationsComplete:
      input.result.resolvedInputs.criticalObligationsComplete,
    firstForecastRisk: input.result.horizons.firstRisk,
    generatedAt,
    validUntil,
    explanationRefs,
  });

  return {
    userId: input.trustedUserId,
    revision: `ctx:${sourceFingerprint}`,
    sourceFingerprint,
    manifestFingerprint: input.manifest.manifestFingerprint,
    analysisFingerprint: input.manifest.analysisFingerprint,
    globalCoverageFingerprint: input.manifest.globalCoverageFingerprint,
    sourceOrchestrationFingerprint:
      input.manifest.sourceOrchestrationFingerprint,
    globalResultFingerprint: input.manifest.globalResultFingerprint,
    currency: input.result.context.currency,
    status: input.result.context.available.status,
    horizonUntil: input.result.context.horizonUntil,
    horizonReason: input.result.primaryHorizon.reason,
    liquidityUsableMinor: input.result.context.liquidityUsableMinor,
    protectedCommitmentsMinor: input.result.context.protectedCommitmentsMinor,
    essentialSpendExpectedMinor: input.result.essentialSpend.expectedMinor,
    protectedReserveMinor: input.result.resolvedInputs.protectedReserveMinor,
    criticalProvisionsMinor: input.result.resolvedInputs.criticalProvisionsMinor,
    confirmedIncomeMinor: input.result.resolvedInputs.confirmedIncomeMinor,
    uncertaintyBufferMinor: input.result.resolvedInputs.uncertaintyBufferMinor,
    availableRealSafeMinor: input.result.context.available.availableRealSafeMinor,
    minimumProjectedCashMinor: input.result.context.minimumProjectedCashMinor,
    minimumProjectedCashAt: input.result.context.minimumProjectedCashAt,
    confidence: input.result.confidence,
    sourcesFresh: input.result.context.sourcesFresh,
    criticalSourcesComplete: input.result.resolvedInputs.criticalSourcesComplete,
    criticalObligationsComplete:
      input.result.resolvedInputs.criticalObligationsComplete,
    firstForecastRisk: input.result.horizons.firstRisk,
    generatedAt,
    validUntil,
    explanationRefs,
  };
}

/**
 * Design-only multi-provider persistence planning.
 *
 * Each original provider receives its own provider-scoped ingestion/upsert plan.
 * A single separately-bound global context is planned only when the trusted
 * global closure is structurally complete. This function performs no writes.
 */
export function buildMultiProviderScopedPersistencePlan(input: {
  trustedUserId: string;
  bundles: TrustedScopedSourceBundle[];
  globalSourceClosure: TrustedGlobalSourceClosure;
  result: GlobalZeroEntryAutopilotResult;
  nowIso: string;
}): MultiProviderScopedPersistencePlan {
  const manifest = buildMultiProviderPersistenceManifest({
    trustedUserId: input.trustedUserId,
    bundles: input.bundles,
    globalSourceClosure: input.globalSourceClosure,
    result: input.result,
    nowIso: input.nowIso,
  });

  const scopeByFingerprint = new Map(
    manifest.providerScopes.map((scope) => [scope.scopeFingerprint, scope]),
  );
  const providerPlans = input.bundles.map((bundle) => {
    const material = providerScopeMaterial({
      trustedUserId: input.trustedUserId,
      snapshot: bundle.snapshot,
    });
    const expected = scopeByFingerprint.get(material.scopeFingerprint);
    if (!expected || expected.providerKey !== material.providerKey) {
      throw new Error("financial_multi_provider_persistence_manifest_scope_missing");
    }
    return buildProviderPlan({
      trustedUserId: input.trustedUserId,
      bundle,
      expectedScopeFingerprint: expected.scopeFingerprint,
      expectedSnapshotFingerprint: expected.snapshotFingerprint,
    });
  });
  providerPlans.sort((a, b) =>
    `${a.providerKey}:${a.scopeFingerprint}`.localeCompare(
      `${b.providerKey}:${b.scopeFingerprint}`,
    ),
  );

  if (providerPlans.length !== manifest.providerScopes.length) {
    throw new Error("financial_multi_provider_persistence_scope_count_mismatch");
  }
  for (let index = 0; index < providerPlans.length; index += 1) {
    if (
      providerPlans[index].scopeFingerprint !==
        manifest.providerScopes[index].scopeFingerprint ||
      providerPlans[index].snapshotFingerprint !==
        manifest.providerScopes[index].snapshotFingerprint
    ) {
      throw new Error("financial_multi_provider_persistence_scope_order_mismatch");
    }
  }

  const globalContextPlan = buildGlobalContextPlan({
    trustedUserId: input.trustedUserId,
    bundles: input.bundles,
    manifest,
    result: input.result,
    nowIso: input.nowIso,
  });
  const planFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-scoped-persistence-plan-v1",
    trustedUserId: input.trustedUserId,
    manifestFingerprint: manifest.manifestFingerprint,
    providerPlans: providerPlans.map((plan) => ({
      providerKey: plan.providerKey,
      scopeFingerprint: plan.scopeFingerprint,
      providerPlanFingerprint: plan.providerPlanFingerprint,
    })),
    globalContextRevision: globalContextPlan?.revision ?? null,
  });

  return {
    version: "multi-provider-scoped-persistence-plan-v1",
    userId: input.trustedUserId,
    manifest,
    providerPlans,
    globalContextPlan,
    planFingerprint,
  };
}
