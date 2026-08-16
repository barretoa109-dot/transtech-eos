import {
  TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import { buildMultiProviderScopedPersistencePlan } from "./multi-provider-scoped-persistence";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  financialSourceCoverageRef,
  resolveTrustedSourceCoverage,
} from "./source-coverage";
import {
  buildZeroEntryFinancialAutopilotFromGlobalSources,
} from "./zero-entry";
import type {
  FinancialAccount,
  FinancialConnectorSnapshot,
  LedgerEntry,
} from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000170";
const AS_OF = "2026-08-16T19:20:00.000Z";
const VALID_UNTIL = "2026-08-17T12:00:00.000Z";

function account(input: {
  id: string;
  connectionId: string;
  externalAccountId: string;
  amountMinor: number;
  freshUntil?: string;
}): FinancialAccount {
  return {
    id: input.id,
    userId: USER_ID,
    externalAccountId: input.externalAccountId,
    connectionId: input.connectionId,
    type: "checking",
    institutionName: input.connectionId,
    displayName: input.externalAccountId,
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: input.amountMinor,
    ledgerBalanceMinor: input.amountMinor,
    balanceAsOf: AS_OF,
    freshUntil: input.freshUntil ?? VALID_UNTIL,
  };
}

function ledger(input: {
  id: string;
  accountId: string;
  sourceEventId: string;
  externalTransactionId: string;
  amountMinor: number;
}): LedgerEntry {
  return {
    id: input.id,
    userId: USER_ID,
    accountId: input.accountId,
    sourceEventId: input.sourceEventId,
    externalTransactionId: input.externalTransactionId,
    type: "expense",
    direction: "debit",
    status: "posted",
    amountMinor: input.amountMinor,
    currency: "PYG",
    occurredAt: "2026-08-15T14:00:00.000Z",
    postedAt: "2026-08-15T14:05:00.000Z",
    descriptionRaw: input.id,
    merchantNormalized: "merchant",
    category: "other",
    subcategory: null,
    counterpartyRef: null,
    internalTransferGroupId: null,
    recurrenceId: null,
    reversalOf: null,
    confidence: 0.99,
    provenance: "multi_provider_scoped_persistence_fixture",
  };
}

function bundle(input: {
  providerKey: string;
  account: FinancialAccount;
  ledger: LedgerEntry;
  expectedExtraExternalAccountId?: string;
}): TrustedScopedSourceBundle {
  const snapshot: FinancialConnectorSnapshot = {
    providerKey: input.providerKey,
    fetchedAt: AS_OF,
    accounts: [input.account],
    ledgerEntries: [input.ledger],
  };
  const expectedSources = [
    {
      sourceRef: financialAccountSourceCoverageRef({
        userId: USER_ID,
        providerKey: input.providerKey,
        account: input.account,
      }),
      materiality: "critical" as const,
      confidence: 0.99,
    },
  ];
  if (input.expectedExtraExternalAccountId) {
    expectedSources.push({
      sourceRef: financialSourceCoverageRef({
        userId: USER_ID,
        providerKey: input.providerKey,
        connectionId: input.account.connectionId,
        externalAccountId: input.expectedExtraExternalAccountId,
      }),
      materiality: "critical" as const,
      confidence: 0.99,
    });
  }

  return {
    snapshot,
    inventory: {
      version: TRUSTED_SOURCE_INVENTORY_VERSION,
      userId: USER_ID,
      asOf: AS_OF,
      validUntil: VALID_UNTIL,
      authority: "provider_discovery",
      scope: "provider_connection",
      discoveryComplete: true,
      confidence: 0.99,
      unresolvedMaterialSourceCount: 0,
      expectedSources,
    },
  };
}

function leafFingerprint(bundleValue: TrustedScopedSourceBundle) {
  const resolution = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: bundleValue.snapshot,
    inventory: bundleValue.inventory,
    nowIso: AS_OF,
  });
  if (!resolution.inventoryFingerprint) {
    throw new Error("scoped persistence fixture missing inventory fingerprint");
  }
  return resolution.inventoryFingerprint;
}

function closure(bundles: TrustedScopedSourceBundle[]): TrustedGlobalSourceClosure {
  return {
    version: TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
    userId: USER_ID,
    asOf: AS_OF,
    validUntil: VALID_UNTIL,
    authority: "user_confirmed",
    confidence: 0.99,
    confirmsNoOtherMaterialSources: true,
    coveredInventoryFingerprints: bundles.map(leafFingerprint),
  };
}

function zeroEntry(
  bundles: TrustedScopedSourceBundle[],
  globalSourceClosure: TrustedGlobalSourceClosure,
) {
  return buildZeroEntryFinancialAutopilotFromGlobalSources({
    trustedUserId: USER_ID,
    bundles,
    globalSourceClosure,
    currency: "PYG",
    asOf: AS_OF,
    protectedReserveMinor: 1000000,
    criticalObligationsComplete: true,
    criticalProvisionsMinor: 0,
    baseUncertaintyBufferMinor: 0,
  });
}

function plan(bundles: TrustedScopedSourceBundle[]) {
  const globalSourceClosure = closure(bundles);
  const result = zeroEntry(bundles, globalSourceClosure);
  return buildMultiProviderScopedPersistencePlan({
    trustedUserId: USER_ID,
    bundles,
    globalSourceClosure,
    result,
    nowIso: AS_OF,
  });
}

export function runMultiProviderScopedPersistenceScenario() {
  const accountA = account({
    id: "20000000-0000-4000-8000-000000000170",
    connectionId: "connection-a",
    externalAccountId: "checking-a",
    amountMinor: 5000000,
  });
  const accountB = account({
    id: "20000000-0000-4000-8000-000000000171",
    connectionId: "connection-b",
    externalAccountId: "checking-b",
    amountMinor: 3000000,
  });
  const bankA = bundle({
    providerKey: "provider-a",
    account: accountA,
    ledger: ledger({
      id: "30000000-0000-4000-8000-000000000170",
      accountId: accountA.id,
      sourceEventId: "event-a",
      externalTransactionId: "tx-a",
      amountMinor: 100000,
    }),
  });
  const bankB = bundle({
    providerKey: "provider-b",
    account: accountB,
    ledger: ledger({
      id: "30000000-0000-4000-8000-000000000171",
      accountId: accountB.id,
      sourceEventId: "event-b",
      externalTransactionId: "tx-b",
      amountMinor: 200000,
    }),
  });
  const healthyBundles = [bankA, bankB];
  const healthy = plan(healthyBundles);
  const reordered = plan([...healthyBundles].reverse());

  const staleAccountB = account({
    id: accountB.id,
    connectionId: accountB.connectionId,
    externalAccountId: accountB.externalAccountId,
    amountMinor: 3000000,
    freshUntil: "2026-08-16T19:19:59.999Z",
  });
  const staleBankB = bundle({
    providerKey: "provider-b",
    account: staleAccountB,
    ledger: { ...bankB.snapshot.ledgerEntries[0], accountId: staleAccountB.id },
  });
  const stale = plan([bankA, staleBankB]);

  const incompleteBankB = bundle({
    providerKey: "provider-b",
    account: accountB,
    ledger: bankB.snapshot.ledgerEntries[0],
    expectedExtraExternalAccountId: "loan-b-not-connected",
  });
  const incomplete = plan([bankA, incompleteBankB]);

  const providerAPlan = healthy.providerPlans.find(
    (providerPlan) => providerPlan.providerKey === "provider-a",
  );
  const providerBPlan = healthy.providerPlans.find(
    (providerPlan) => providerPlan.providerKey === "provider-b",
  );

  const checks = {
    providerWritesRemainStrictlyScoped:
      healthy.providerPlans.length === 2 &&
      providerAPlan?.connectionUpserts.every(
        (row) => row.providerKey === "provider-a",
      ) === true &&
      providerAPlan?.ledgerUpserts.every(
        (row) => row.providerKey === "provider-a",
      ) === true &&
      providerBPlan?.connectionUpserts.every(
        (row) => row.providerKey === "provider-b",
      ) === true &&
      providerBPlan?.ledgerUpserts.every(
        (row) => row.providerKey === "provider-b",
      ) === true,
    noSyntheticProviderIsIntroduced:
      healthy.providerPlans.every(
        (providerPlan) =>
          providerPlan.providerKey === "provider-a" ||
          providerPlan.providerKey === "provider-b",
      ),
    oneGlobalContextBindsAllProviderScopes:
      healthy.globalContextPlan !== null &&
      healthy.globalContextPlan.manifestFingerprint ===
        healthy.manifest.manifestFingerprint &&
      healthy.globalContextPlan.analysisFingerprint ===
        healthy.manifest.analysisFingerprint &&
      healthy.globalContextPlan.sourceOrchestrationFingerprint ===
        healthy.manifest.sourceOrchestrationFingerprint,
    globalContextIdentityIsSha256Revision:
      healthy.globalContextPlan !== null &&
      /^[a-f0-9]{64}$/.test(healthy.globalContextPlan.sourceFingerprint) &&
      healthy.globalContextPlan.revision ===
        `ctx:${healthy.globalContextPlan.sourceFingerprint}`,
    planIsOrderIndependent:
      healthy.planFingerprint === reordered.planFingerprint &&
      healthy.globalContextPlan?.revision === reordered.globalContextPlan?.revision &&
      JSON.stringify(
        healthy.providerPlans.map((providerPlan) => providerPlan.providerPlanFingerprint),
      ) ===
        JSON.stringify(
          reordered.providerPlans.map(
            (providerPlan) => providerPlan.providerPlanFingerprint,
          ),
        ),
    staleRemoteProviderKeepsStructureButDegradesGlobalContext:
      stale.globalContextPlan !== null &&
      stale.globalContextPlan.status === "DEGRADED" &&
      !stale.globalContextPlan.sourcesFresh &&
      stale.manifest.globalContextEligible,
    incompleteGlobalCoverageStillPlansProviderIngestionButNoGlobalContext:
      incomplete.providerPlans.length === 2 &&
      !incomplete.manifest.globalContextEligible &&
      incomplete.globalContextPlan === null,
    providerLedgerIdentitiesStayDistinct:
      providerAPlan?.ledgerUpserts.length === 1 &&
      providerBPlan?.ledgerUpserts.length === 1 &&
      providerAPlan.ledgerUpserts[0].canonicalKey !==
        providerBPlan.ledgerUpserts[0].canonicalKey,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    stale,
    incomplete,
  };
}
