import {
  TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import { buildFinancialPersistencePlan } from "./persistence";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  financialSourceCoverageRef,
  resolveTrustedSourceCoverage,
  type TrustedFinancialSourceInventory,
} from "./source-coverage";
import {
  buildZeroEntryFinancialAutopilotFromGlobalSources,
} from "./zero-entry";
import type {
  FinancialAccount,
  FinancialConnectorSnapshot,
  LedgerEntry,
} from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000150";
const CHECKING_ID = "20000000-0000-4000-8000-000000000150";
const CARD_ID = "20000000-0000-4000-8000-000000000151";
const AS_OF = "2026-08-16T12:00:00.000Z";
const VALID_UNTIL = "2026-08-17T12:00:00.000Z";

function checking(): FinancialAccount {
  return {
    id: CHECKING_ID,
    userId: USER_ID,
    externalAccountId: "checking-global-zero-entry",
    connectionId: "connection-bank-a",
    type: "checking",
    institutionName: "Banco A",
    displayName: "Cuenta principal",
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 8000000,
    ledgerBalanceMinor: 8000000,
    balanceAsOf: AS_OF,
    freshUntil: VALID_UNTIL,
  };
}

function card(freshUntil = VALID_UNTIL): FinancialAccount {
  return {
    id: CARD_ID,
    userId: USER_ID,
    externalAccountId: "card-global-zero-entry",
    connectionId: "connection-bank-b",
    type: "card",
    institutionName: "Banco B",
    displayName: "Tarjeta principal",
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: null,
    ledgerBalanceMinor: null,
    balanceAsOf: AS_OF,
    freshUntil,
  };
}

function row(
  id: string,
  direction: "credit" | "debit",
  amountMinor: number,
  occurredAt: string,
  descriptionRaw: string,
  category: string | null = null,
  subcategory: string | null = null,
): LedgerEntry {
  return {
    id,
    userId: USER_ID,
    accountId: CHECKING_ID,
    sourceEventId: `event:${id}`,
    externalTransactionId: `external:${id}`,
    type: direction === "credit" ? "income" : "expense",
    direction,
    status: "posted",
    amountMinor,
    currency: "PYG",
    occurredAt,
    postedAt: occurredAt,
    descriptionRaw,
    merchantNormalized: null,
    category,
    subcategory,
    counterpartyRef: null,
    internalTransferGroupId: null,
    recurrenceId: null,
    reversalOf: null,
    confidence: 0.99,
    provenance: "global_zero_entry_fixture",
  };
}

function history() {
  return [
    row("salary-may", "credit", 9000000, "2026-05-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-jun", "credit", 9000000, "2026-06-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-jul", "credit", 9000000, "2026-07-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-aug", "credit", 9000000, "2026-08-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("rent-may", "debit", 2100000, "2026-05-25T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-jun", "debit", 2100000, "2026-06-25T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-jul", "debit", 2100000, "2026-07-25T12:00:00.000Z", "ALQUILER CASA"),
    row("utility-jun", "debit", 330000, "2026-06-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("utility-jul", "debit", 350000, "2026-07-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("utility-aug", "debit", 340000, "2026-08-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("grocery-a", "debit", 350000, "2026-06-28T18:00:00.000Z", "SUPERMERCADO ALFA", "food", "groceries"),
    row("grocery-b", "debit", 350000, "2026-07-05T18:00:00.000Z", "SUPERMERCADO BETA", "food", "groceries"),
    row("grocery-c", "debit", 350000, "2026-07-12T18:00:00.000Z", "SUPERMERCADO GAMMA", "food", "groceries"),
    row("grocery-d", "debit", 350000, "2026-07-19T18:00:00.000Z", "SUPERMERCADO DELTA", "food", "groceries"),
    row("grocery-e", "debit", 350000, "2026-07-26T18:00:00.000Z", "SUPERMERCADO EPSILON", "food", "groceries"),
    row("grocery-f", "debit", 350000, "2026-08-02T18:00:00.000Z", "SUPERMERCADO ZETA", "food", "groceries"),
    row("grocery-g", "debit", 350000, "2026-08-09T18:00:00.000Z", "SUPERMERCADO ETA", "food", "groceries"),
    row("grocery-h", "debit", 350000, "2026-08-16T10:00:00.000Z", "SUPERMERCADO THETA", "food", "groceries"),
  ];
}

function providerSnapshot(
  providerKey: string,
  account: FinancialAccount,
  ledgerEntries: LedgerEntry[],
): FinancialConnectorSnapshot {
  return {
    providerKey,
    fetchedAt: AS_OF,
    accounts: [account],
    ledgerEntries,
  };
}

function bundle(input: {
  providerKey: string;
  account: FinancialAccount;
  ledgerEntries?: LedgerEntry[];
  missingMaterialExternalId?: string;
}): TrustedScopedSourceBundle {
  const snapshot = providerSnapshot(
    input.providerKey,
    input.account,
    input.ledgerEntries ?? [],
  );
  const expectedSources: TrustedFinancialSourceInventory["expectedSources"] = [
    {
      sourceRef: financialAccountSourceCoverageRef({
        userId: USER_ID,
        providerKey: input.providerKey,
        account: input.account,
      }),
      materiality: input.account.type === "checking" ? "critical" : "material",
      confidence: 0.99,
    },
  ];
  if (input.missingMaterialExternalId) {
    expectedSources.push({
      sourceRef: financialSourceCoverageRef({
        userId: USER_ID,
        providerKey: input.providerKey,
        connectionId: input.account.connectionId,
        externalAccountId: input.missingMaterialExternalId,
      }),
      materiality: "material",
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
    throw new Error("global zero-entry fixture missing leaf fingerprint");
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

function build(bundles: TrustedScopedSourceBundle[]) {
  return buildZeroEntryFinancialAutopilotFromGlobalSources({
    trustedUserId: USER_ID,
    bundles,
    globalSourceClosure: closure(bundles),
    currency: "PYG",
    asOf: AS_OF,
    protectedReserveMinor: 3000000,
    criticalObligationsComplete: true,
    criticalProvisionsMinor: 100000,
    baseUncertaintyBufferMinor: 120000,
  });
}

export function runGlobalZeroEntryScenario() {
  const bankA = bundle({
    providerKey: "provider-bank-a",
    account: checking(),
    ledgerEntries: history(),
  });
  const bankB = bundle({
    providerKey: "provider-bank-b",
    account: card(),
  });
  const healthyBundles = [bankA, bankB];
  const healthy = build(healthyBundles);
  const reordered = build([...healthyBundles].reverse());

  const staleCardBundle = bundle({
    providerKey: "provider-bank-b",
    account: card("2026-08-16T11:59:59.999Z"),
  });
  const stale = build([bankA, staleCardBundle]);

  const incompleteCardBundle = bundle({
    providerKey: "provider-bank-b",
    account: card(),
    missingMaterialExternalId: "loan-bank-b-missing",
  });
  const incomplete = build([bankA, incompleteCardBundle]);

  let singleProviderPersistenceRejected = false;
  try {
    buildFinancialPersistencePlan({
      snapshot: bankA.snapshot,
      result: healthy,
    });
  } catch (error) {
    singleProviderPersistenceRejected =
      error instanceof Error &&
      error.message === "financial_multi_provider_requires_scoped_persistence";
  }

  const checks = {
    multiProviderZeroEntryUsesGlobalCoverage:
      healthy.analysisScope === "multi_provider" &&
      healthy.sourceCoverage.criticalSourcesComplete &&
      healthy.sourceCoverage.criticalSourcesFresh &&
      healthy.sourceCoverage.inventoryFingerprint !== null &&
      healthy.sourceOrchestrationFingerprint !== null,
    multiProviderAnalysisCanReachSameSafeProductSemantics:
      healthy.context.available.status === "SAFE" &&
      healthy.nextAction.outcome === "NO_ACTION",
    providerOrderingDoesNotChangeAutopilotOutcome:
      healthy.sourceOrchestrationFingerprint ===
        reordered.sourceOrchestrationFingerprint &&
      healthy.context.available.status === reordered.context.available.status &&
      healthy.context.available.availableRealSafeMinor ===
        reordered.context.available.availableRealSafeMinor,
    staleNonLiquidityProviderFailsFreshnessWithoutLosingCoverage:
      stale.sourceCoverage.criticalSourcesComplete &&
      !stale.sourceCoverage.criticalSourcesFresh &&
      stale.context.available.status === "DEGRADED" &&
      stale.context.available.degradedReasons.includes("critical_source_stale") &&
      stale.nextAction.outcome === "CONNECTION_REQUIRED",
    incompleteScopedProviderNeverClaimsGlobalSafe:
      !incomplete.sourceCoverage.criticalSourcesComplete &&
      incomplete.context.available.status === "DEGRADED" &&
      incomplete.context.available.degradedReasons.includes("critical_sources_incomplete") &&
      incomplete.sourceOrchestrationFingerprint === null,
    v1PersistenceRefusesMultiProviderResultBeforeFlattening:
      singleProviderPersistenceRejected,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy: {
      status: healthy.context.available.status,
      analysisScope: healthy.analysisScope,
      sourceCoverageComplete: healthy.sourceCoverage.criticalSourcesComplete,
      sourceCoverageFresh: healthy.sourceCoverage.criticalSourcesFresh,
      hasOrchestrationFingerprint:
        healthy.sourceOrchestrationFingerprint !== null,
    },
    staleStatus: stale.context.available,
    incompleteStatus: incomplete.context.available,
    singleProviderPersistenceRejected,
  };
}
