import {
  TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import { InMemoryMultiProviderPersistenceStore } from "./multi-provider-persistence-store";
import { buildMultiProviderScopedPersistencePlan } from "./multi-provider-scoped-persistence";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  resolveTrustedSourceCoverage,
} from "./source-coverage";
import type {
  FinancialAccount,
  FinancialConnectorSnapshot,
  LedgerEntry,
} from "./types";
import { buildZeroEntryFinancialAutopilotFromGlobalSources } from "./zero-entry";

const USER_ID = "00000000-0000-4000-8000-000000000170";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000171";
const AS_OF = "2026-08-16T19:20:00.000Z";
const VALID_UNTIL = "2026-08-17T12:00:00.000Z";

function account(input: {
  id: string;
  connectionId: string;
  externalAccountId: string;
  amountMinor: number;
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
    freshUntil: VALID_UNTIL,
  };
}

function entry(input: {
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
    occurredAt: AS_OF,
    postedAt: AS_OF,
    descriptionRaw: input.sourceEventId,
    merchantNormalized: null,
    category: "other",
    subcategory: null,
    counterpartyRef: null,
    internalTransferGroupId: null,
    recurrenceId: null,
    reversalOf: null,
    confidence: 0.99,
    provenance: "multi_provider_persistence_store_fixture",
  };
}

function bundle(input: {
  providerKey: string;
  accountValue: FinancialAccount;
  entryValue: LedgerEntry;
}): TrustedScopedSourceBundle {
  const snapshot: FinancialConnectorSnapshot = {
    providerKey: input.providerKey,
    fetchedAt: AS_OF,
    accounts: [input.accountValue],
    ledgerEntries: [input.entryValue],
  };
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
      expectedSources: [
        {
          sourceRef: financialAccountSourceCoverageRef({
            userId: USER_ID,
            providerKey: input.providerKey,
            account: input.accountValue,
          }),
          materiality: "critical",
          confidence: 0.99,
        },
      ],
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
    throw new Error("multi-provider persistence store fixture missing fingerprint");
  }
  return resolution.inventoryFingerprint;
}

function closure(
  bundles: TrustedScopedSourceBundle[],
  confirmsNoOtherMaterialSources = true,
): TrustedGlobalSourceClosure {
  return {
    version: TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
    userId: USER_ID,
    asOf: AS_OF,
    validUntil: VALID_UNTIL,
    authority: "user_confirmed",
    confidence: 0.99,
    confirmsNoOtherMaterialSources,
    coveredInventoryFingerprints: bundles.map(leafFingerprint),
  };
}

function planFor(
  bundles: TrustedScopedSourceBundle[],
  confirmsNoOtherMaterialSources = true,
) {
  const globalSourceClosure = closure(bundles, confirmsNoOtherMaterialSources);
  const result = buildZeroEntryFinancialAutopilotFromGlobalSources({
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
  return buildMultiProviderScopedPersistencePlan({
    trustedUserId: USER_ID,
    bundles,
    globalSourceClosure,
    result,
    nowIso: AS_OF,
  });
}

function fixtures(input?: {
  bankABalanceMinor?: number;
  bankBExpenseMinor?: number;
}) {
  const accountA = account({
    id: "20000000-0000-4000-8000-000000000170",
    connectionId: "connection-a",
    externalAccountId: "checking-a",
    amountMinor: input?.bankABalanceMinor ?? 5000000,
  });
  const accountB = account({
    id: "20000000-0000-4000-8000-000000000171",
    connectionId: "connection-b",
    externalAccountId: "checking-b",
    amountMinor: 3000000,
  });
  return [
    bundle({
      providerKey: "provider-a",
      accountValue: accountA,
      entryValue: entry({
        id: "30000000-0000-4000-8000-000000000170",
        accountId: accountA.id,
        sourceEventId: "event-a",
        externalTransactionId: "tx-a",
        amountMinor: 100000,
      }),
    }),
    bundle({
      providerKey: "provider-b",
      accountValue: accountB,
      entryValue: entry({
        id: "30000000-0000-4000-8000-000000000171",
        accountId: accountB.id,
        sourceEventId: "event-b",
        externalTransactionId: "tx-b",
        amountMinor: input?.bankBExpenseMinor ?? 200000,
      }),
    }),
  ];
}

function catchesCode(work: () => Promise<unknown>, code: string) {
  return work().then(
    () => false,
    (error) => error instanceof Error && error.message === code,
  );
}

export async function runMultiProviderPersistenceStoreScenario() {
  const store = new InMemoryMultiProviderPersistenceStore(USER_ID);
  const basePlan = planFor(fixtures());
  const first = await store.persist(basePlan);
  const countsAfterFirst = store.snapshotCounts();
  const replay = await store.persist(basePlan);
  const countsAfterReplay = store.snapshotCounts();

  // Valid second plan: provider A has a new mutable balance while provider B
  // reuses the same immutable event identity with changed economic material.
  // The conflict happens after staged work begins, so unchanged counts prove
  // transaction-like rollback rather than merely pre-validation rejection.
  const conflictingPlan = planFor(
    fixtures({ bankABalanceMinor: 5500000, bankBExpenseMinor: 250000 }),
  );
  const conflictBlocked = await catchesCode(
    () => store.persist(conflictingPlan),
    "financial_multi_provider_ingestion_replay_mismatch",
  );
  const countsAfterConflict = store.snapshotCounts();

  const wrongUserPlan = {
    ...basePlan,
    userId: OTHER_USER_ID,
  };
  const crossUserBlocked = await catchesCode(
    () => store.persist(wrongUserPlan),
    "financial_multi_provider_store_user_or_version_mismatch",
  );

  const incompleteStore = new InMemoryMultiProviderPersistenceStore(USER_ID);
  const incompletePlan = planFor(fixtures(), false);
  const incompletePersist = await incompleteStore.persist(incompletePlan);

  const tamperedGlobalContextPlan = basePlan.globalContextPlan
    ? {
        ...basePlan,
        globalContextPlan: {
          ...basePlan.globalContextPlan,
          availableRealSafeMinor:
            basePlan.globalContextPlan.availableRealSafeMinor + 1,
        },
      }
    : basePlan;
  const contextTamperBlocked = await catchesCode(
    () => store.persist(tamperedGlobalContextPlan),
    "financial_multi_provider_store_invalid_global_context_identity",
  );

  const checks = {
    firstWriteTouchesBothProviderScopes:
      !first.replayed &&
      first.providerScopesTouched === 2 &&
      first.globalContextRevision === basePlan.globalContextPlan?.revision,
    exactReplayIsNoOp:
      replay.replayed &&
      replay.providerScopesTouched === 0 &&
      replay.ledgerRowsTouched === 0 &&
      replay.ingestionRowsTouched === 0 &&
      JSON.stringify(countsAfterFirst) === JSON.stringify(countsAfterReplay),
    immutableProviderEventConflictFailsClosed: conflictBlocked,
    conflictRollsBackAllStagedProviderChanges:
      JSON.stringify(countsAfterFirst) === JSON.stringify(countsAfterConflict),
    crossUserPlanFailsBeforeMutation: crossUserBlocked,
    globalContextMaterialTamperFailsIdentityCheck: contextTamperBlocked,
    incompleteGlobalCoveragePersistsProvidersWithoutGlobalContext:
      incompletePlan.providerPlans.length === 2 &&
      incompletePlan.globalContextPlan === null &&
      incompletePersist.globalContextRevision === null &&
      incompleteStore.snapshotCounts().providerScopes === 2 &&
      incompleteStore.snapshotCounts().globalContexts === 0,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    first,
    replay,
    countsAfterFirst,
    countsAfterConflict,
  };
}
