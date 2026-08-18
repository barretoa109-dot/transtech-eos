import {
  TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import { orchestrateTrustedGlobalFinancialSources } from "./global-source-orchestration";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  financialSourceCoverageRef,
  resolveTrustedSourceCoverage,
  type TrustedFinancialSourceInventory,
} from "./source-coverage";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000140";
const NOW = "2026-08-16T18:55:00.000Z";
const VALID_UNTIL = "2026-08-17T12:00:00.000Z";

function account(input: {
  id: string;
  connectionId: string;
  externalAccountId: string;
  type?: FinancialAccount["type"];
  freshUntil?: string;
}): FinancialAccount {
  return {
    id: input.id,
    userId: USER_ID,
    externalAccountId: input.externalAccountId,
    connectionId: input.connectionId,
    type: input.type ?? "checking",
    institutionName: input.connectionId,
    displayName: input.externalAccountId,
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: input.type === "card" ? null : 4000000,
    ledgerBalanceMinor: input.type === "card" ? null : 4000000,
    balanceAsOf: NOW,
    freshUntil: input.freshUntil ?? VALID_UNTIL,
  };
}

function bundle(input: {
  providerKey: string;
  account: FinancialAccount;
  expectedExtraExternalId?: string;
}): TrustedScopedSourceBundle {
  const snapshot: FinancialConnectorSnapshot = {
    providerKey: input.providerKey,
    fetchedAt: NOW,
    accounts: [input.account],
    ledgerEntries: [],
  };
  const expectedSources: TrustedFinancialSourceInventory["expectedSources"] = [
    {
      sourceRef: financialAccountSourceCoverageRef({
        userId: USER_ID,
        providerKey: snapshot.providerKey,
        account: input.account,
      }),
      materiality: input.account.type === "checking" ? "critical" : "material",
      confidence: 0.99,
    },
  ];
  if (input.expectedExtraExternalId) {
    expectedSources.push({
      sourceRef: financialSourceCoverageRef({
        userId: USER_ID,
        providerKey: snapshot.providerKey,
        connectionId: input.account.connectionId,
        externalAccountId: input.expectedExtraExternalId,
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
      asOf: NOW,
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
    nowIso: NOW,
  });
  if (!resolution.inventoryFingerprint) {
    throw new Error("orchestration fixture missing leaf fingerprint");
  }
  return resolution.inventoryFingerprint;
}

function closure(bundles: TrustedScopedSourceBundle[]): TrustedGlobalSourceClosure {
  return {
    version: TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
    userId: USER_ID,
    asOf: NOW,
    validUntil: VALID_UNTIL,
    authority: "user_confirmed",
    confidence: 0.99,
    confirmsNoOtherMaterialSources: true,
    coveredInventoryFingerprints: bundles.map(leafFingerprint),
  };
}

export function runGlobalSourceOrchestrationScenario() {
  const bankA = bundle({
    providerKey: "provider-a",
    account: account({
      id: "20000000-0000-4000-8000-000000000140",
      connectionId: "connection-a",
      externalAccountId: "checking-a",
    }),
  });
  const bankB = bundle({
    providerKey: "provider-b",
    account: account({
      id: "20000000-0000-4000-8000-000000000141",
      connectionId: "connection-b",
      externalAccountId: "card-b",
      type: "card",
    }),
  });
  const healthyBundles = [bankA, bankB];
  const healthyClosure = closure(healthyBundles);

  const healthy = orchestrateTrustedGlobalFinancialSources({
    trustedUserId: USER_ID,
    bundles: healthyBundles,
    closure: healthyClosure,
    nowIso: NOW,
  });
  const reordered = orchestrateTrustedGlobalFinancialSources({
    trustedUserId: USER_ID,
    bundles: [...healthyBundles].reverse(),
    closure: {
      ...healthyClosure,
      coveredInventoryFingerprints: [
        ...healthyClosure.coveredInventoryFingerprints,
      ].reverse(),
    },
    nowIso: NOW,
  });

  const staleBankB = bundle({
    providerKey: "provider-b",
    account: account({
      id: "20000000-0000-4000-8000-000000000142",
      connectionId: "connection-b",
      externalAccountId: "card-b",
      type: "card",
      freshUntil: "2026-08-16T18:54:59.999Z",
    }),
  });
  const staleBundles = [bankA, staleBankB];
  const stale = orchestrateTrustedGlobalFinancialSources({
    trustedUserId: USER_ID,
    bundles: staleBundles,
    closure: closure(staleBundles),
    nowIso: NOW,
  });

  const incompleteBankB = bundle({
    providerKey: "provider-b",
    account: account({
      id: "20000000-0000-4000-8000-000000000143",
      connectionId: "connection-b",
      externalAccountId: "card-b",
      type: "card",
    }),
    expectedExtraExternalId: "loan-b-missing",
  });
  const incompleteBundles = [bankA, incompleteBankB];
  const incomplete = orchestrateTrustedGlobalFinancialSources({
    trustedUserId: USER_ID,
    bundles: incompleteBundles,
    closure: closure(incompleteBundles),
    nowIso: NOW,
  });

  const checks = {
    coverageAndAnalysisUseSameProviderSet:
      healthy.coverage.criticalSourcesComplete &&
      healthy.analysis.providerScopes.length === 2 &&
      healthy.analysis.providerScopes.some(
        (scope) => scope.providerKey === "provider-a",
      ) &&
      healthy.analysis.providerScopes.some(
        (scope) => scope.providerKey === "provider-b",
      ) &&
      healthy.orchestrationFingerprint !== null,
    orchestrationIdentityIsOrderIndependent:
      healthy.orchestrationFingerprint === reordered.orchestrationFingerprint &&
      healthy.analysis.analysisFingerprint === reordered.analysis.analysisFingerprint &&
      healthy.coverage.inventoryFingerprint === reordered.coverage.inventoryFingerprint,
    staleKnownSourceKeepsCoverageButChangesBoundAnalysis:
      stale.coverage.criticalSourcesComplete &&
      !stale.coverage.criticalSourcesFresh &&
      stale.orchestrationFingerprint !== null &&
      stale.analysis.analysisFingerprint !== healthy.analysis.analysisFingerprint &&
      stale.orchestrationFingerprint !== healthy.orchestrationFingerprint,
    incompleteGlobalCoverageCannotProduceTrustedOrchestrationIdentity:
      !incomplete.coverage.criticalSourcesComplete &&
      incomplete.coverage.reasonCodes.includes("scoped_inventory_invalid") &&
      incomplete.orchestrationFingerprint === null,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    stale,
    incomplete,
  };
}
