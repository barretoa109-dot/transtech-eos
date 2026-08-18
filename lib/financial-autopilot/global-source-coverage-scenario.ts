import {
  TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
  aggregateTrustedGlobalSourceCoverage,
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  financialSourceCoverageRef,
  resolveTrustedSourceCoverage,
  type TrustedFinancialSourceInventory,
} from "./source-coverage";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000120";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000121";
const NOW = "2026-08-16T18:30:00.000Z";
const VALID_UNTIL = "2026-08-17T12:00:00.000Z";

function account(input: {
  id: string;
  externalAccountId: string;
  connectionId: string;
  type?: FinancialAccount["type"];
  freshUntil?: string;
}): FinancialAccount {
  return {
    id: input.id,
    userId: USER_ID,
    externalAccountId: input.externalAccountId,
    connectionId: input.connectionId,
    type: input.type ?? "checking",
    institutionName: `Institution ${input.connectionId}`,
    displayName: input.externalAccountId,
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: input.type === "card" ? null : 5000000,
    ledgerBalanceMinor: input.type === "card" ? null : 5000000,
    balanceAsOf: NOW,
    freshUntil: input.freshUntil ?? VALID_UNTIL,
  };
}

function snapshot(
  providerKey: string,
  accounts: FinancialAccount[],
): FinancialConnectorSnapshot {
  return {
    providerKey,
    fetchedAt: NOW,
    accounts,
    ledgerEntries: [],
  };
}

function scopedInventory(input: {
  snapshot: FinancialConnectorSnapshot;
  scope?: TrustedFinancialSourceInventory["scope"];
  authority?: TrustedFinancialSourceInventory["authority"];
  validUntil?: string;
  expectedExtraExternalId?: string;
}): TrustedFinancialSourceInventory {
  const expectedSources: TrustedFinancialSourceInventory["expectedSources"] =
    input.snapshot.accounts.map(
      (connected): TrustedFinancialSourceInventory["expectedSources"][number] => ({
        sourceRef: financialAccountSourceCoverageRef({
          userId: USER_ID,
          providerKey: input.snapshot.providerKey,
          account: connected,
        }),
        materiality: connected.type === "checking" ? "critical" : "material",
        confidence: 0.99,
      }),
    );

  if (input.expectedExtraExternalId) {
    const connectionId = input.snapshot.accounts[0]?.connectionId;
    if (!connectionId) throw new Error("global coverage fixture missing connection");
    expectedSources.push({
      sourceRef: financialSourceCoverageRef({
        userId: USER_ID,
        providerKey: input.snapshot.providerKey,
        connectionId,
        externalAccountId: input.expectedExtraExternalId,
      }),
      materiality: "material",
      confidence: 0.99,
    });
  }

  return {
    version: TRUSTED_SOURCE_INVENTORY_VERSION,
    userId: USER_ID,
    asOf: NOW,
    validUntil: input.validUntil ?? VALID_UNTIL,
    authority: input.authority ?? "provider_discovery",
    scope: input.scope ?? "provider_connection",
    discoveryComplete: true,
    confidence: 0.99,
    unresolvedMaterialSourceCount: 0,
    expectedSources,
  };
}

function bundle(
  providerKey: string,
  accounts: FinancialAccount[],
  inventoryPatch: Omit<Parameters<typeof scopedInventory>[0], "snapshot"> = {},
): TrustedScopedSourceBundle {
  const snapshotValue = snapshot(providerKey, accounts);
  return {
    snapshot: snapshotValue,
    inventory: scopedInventory({ snapshot: snapshotValue, ...inventoryPatch }),
  };
}

function leafFingerprint(bundleValue: TrustedScopedSourceBundle) {
  const resolved = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: bundleValue.snapshot,
    inventory: bundleValue.inventory,
    nowIso: NOW,
  });
  if (!resolved.inventoryFingerprint) {
    throw new Error("global coverage fixture missing leaf fingerprint");
  }
  return resolved.inventoryFingerprint;
}

function closure(
  bundles: TrustedScopedSourceBundle[],
  patch: Partial<TrustedGlobalSourceClosure> = {},
): TrustedGlobalSourceClosure {
  return {
    version: TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
    userId: USER_ID,
    asOf: NOW,
    validUntil: VALID_UNTIL,
    authority: "user_confirmed",
    confidence: 0.99,
    confirmsNoOtherMaterialSources: true,
    coveredInventoryFingerprints: bundles.map(leafFingerprint),
    ...patch,
  };
}

function catchesCode(work: () => unknown, code: string) {
  try {
    work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

export function runGlobalSourceCoverageScenario() {
  const bankA = bundle("provider-bank-a", [
    account({
      id: "20000000-0000-4000-8000-000000000120",
      externalAccountId: "checking-a",
      connectionId: "connection-a",
    }),
  ]);
  const bankB = bundle("provider-bank-b", [
    account({
      id: "20000000-0000-4000-8000-000000000121",
      externalAccountId: "card-b",
      connectionId: "connection-b",
      type: "card",
    }),
  ]);
  const healthyBundles = [bankA, bankB];
  const healthyClosure = closure(healthyBundles);

  const healthy = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: healthyBundles,
    closure: healthyClosure,
    nowIso: NOW,
  });
  const reordered = aggregateTrustedGlobalSourceCoverage({
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

  const staleBankB = bundle("provider-bank-b", [
    account({
      id: "20000000-0000-4000-8000-000000000122",
      externalAccountId: "card-b",
      connectionId: "connection-b",
      type: "card",
      freshUntil: "2026-08-16T18:29:59.999Z",
    }),
  ]);
  const staleBundles = [bankA, staleBankB];
  const staleKnownSource = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: staleBundles,
    closure: closure(staleBundles),
    nowIso: NOW,
  });

  const missingMaterialLeaf = bundle(
    "provider-bank-b",
    [
      account({
        id: "20000000-0000-4000-8000-000000000123",
        externalAccountId: "card-b",
        connectionId: "connection-b",
        type: "card",
      }),
    ],
    { expectedExtraExternalId: "loan-b-not-connected" },
  );
  const missingMaterialBundles = [bankA, missingMaterialLeaf];
  const missingMaterial = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: missingMaterialBundles,
    closure: closure(missingMaterialBundles),
    nowIso: NOW,
  });

  const bindingMismatch = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: healthyBundles,
    closure: {
      ...healthyClosure,
      coveredInventoryFingerprints: [leafFingerprint(bankA)],
    },
    nowIso: NOW,
  });

  const nonExhaustive = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: healthyBundles,
    closure: {
      ...healthyClosure,
      confirmsNoOtherMaterialSources: false,
    },
    nowIso: NOW,
  });

  const lowConfidenceClosure = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: healthyBundles,
    closure: { ...healthyClosure, confidence: 0.89 },
    nowIso: NOW,
  });

  const expiredClosure = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: healthyBundles,
    closure: {
      ...healthyClosure,
      asOf: "2026-08-16T12:00:00.000Z",
      validUntil: NOW,
    },
    nowIso: NOW,
  });

  const providerAuthorityClosure = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: healthyBundles,
    closure: {
      ...healthyClosure,
      authority: "provider_discovery" as unknown as TrustedGlobalSourceClosure["authority"],
    },
    nowIso: NOW,
  });

  const providerSelfGlobalLeaf = bundle(
    "provider-bank-a",
    bankA.snapshot.accounts,
    { scope: "global_user_finances", authority: "provider_discovery" },
  );
  const providerSelfGlobal = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: [providerSelfGlobalLeaf],
    closure: closure([providerSelfGlobalLeaf]),
    nowIso: NOW,
  });

  const overlapA = bundle("provider-overlap", [
    account({
      id: "20000000-0000-4000-8000-000000000124",
      externalAccountId: "same-source",
      connectionId: "overlap-connection",
    }),
  ]);
  const overlapB = bundle(
    "provider-overlap",
    [
      account({
        id: "20000000-0000-4000-8000-000000000125",
        externalAccountId: "same-source",
        connectionId: "overlap-connection",
      }),
    ],
    { validUntil: "2026-08-17T11:00:00.000Z" },
  );
  const overlapBundles = [overlapA, overlapB];
  const overlappingIdentity = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: overlapBundles,
    closure: closure(overlapBundles),
    nowIso: NOW,
  });

  const closureOwnerBlocked = catchesCode(
    () =>
      aggregateTrustedGlobalSourceCoverage({
        trustedUserId: USER_ID,
        bundles: healthyBundles,
        closure: { ...healthyClosure, userId: OTHER_USER_ID },
        nowIso: NOW,
      }),
    "financial_global_source_coverage_closure_owner_mismatch",
  );
  const snapshotOwnerBlocked = catchesCode(
    () =>
      aggregateTrustedGlobalSourceCoverage({
        trustedUserId: USER_ID,
        bundles: [
          {
            ...bankA,
            snapshot: {
              ...bankA.snapshot,
              accounts: bankA.snapshot.accounts.map((value) => ({
                ...value,
                userId: OTHER_USER_ID,
              })),
            },
          },
        ],
        closure: closure([bankA]),
        nowIso: NOW,
      }),
    "financial_global_source_coverage_snapshot_owner_mismatch",
  );

  const checks = {
    twoScopedProvidersNeedIndependentClosureForGlobalCoverage:
      healthy.criticalSourcesComplete &&
      healthy.criticalSourcesFresh &&
      healthy.reasonCodes.length === 0 &&
      healthy.leafInventoryFingerprints.length === 2 &&
      healthy.inventoryFingerprint !== null &&
      healthy.closureFingerprint !== null,
    aggregationIdentityIsOrderIndependent:
      healthy.inventoryFingerprint === reordered.inventoryFingerprint &&
      healthy.closureFingerprint === reordered.closureFingerprint,
    completeCoverageAndFreshnessRemainIndependent:
      staleKnownSource.criticalSourcesComplete &&
      !staleKnownSource.criticalSourcesFresh &&
      staleKnownSource.staleConnectedSourceCount === 1 &&
      staleKnownSource.freshnessReasonCodes.includes(
        "connected_source_stale_or_unknown",
      ),
    incompleteLeafFailsGlobalCoverage:
      !missingMaterial.criticalSourcesComplete &&
      missingMaterial.reasonCodes.includes("scoped_inventory_invalid"),
    closureMustBindExactLeafSet:
      !bindingMismatch.criticalSourcesComplete &&
      bindingMismatch.reasonCodes.includes("global_closure_binding_mismatch"),
    closureMustExplicitlyBeExhaustive:
      !nonExhaustive.criticalSourcesComplete &&
      nonExhaustive.reasonCodes.includes("global_closure_not_exhaustive"),
    weakClosureConfidenceFailsClosed:
      !lowConfidenceClosure.criticalSourcesComplete &&
      lowConfidenceClosure.reasonCodes.includes(
        "global_closure_confidence_below_threshold",
      ),
    expiredClosureFailsClosed:
      !expiredClosure.criticalSourcesComplete &&
      expiredClosure.reasonCodes.includes("global_closure_not_current"),
    providerCannotActAsIndependentGlobalClosure:
      !providerAuthorityClosure.criticalSourcesComplete &&
      providerAuthorityClosure.reasonCodes.includes(
        "global_closure_authority_insufficient",
      ),
    providerSelfAssertedGlobalLeafIsNotAcceptedAsScopedEvidence:
      !providerSelfGlobal.criticalSourcesComplete &&
      providerSelfGlobal.reasonCodes.includes("scoped_inventory_invalid"),
    overlappingSourceIdentityFailsClosed:
      !overlappingIdentity.criticalSourcesComplete &&
      overlappingIdentity.reasonCodes.includes("overlapping_source_identity"),
    closureOwnerMismatchFailsAtSecurityBoundary: closureOwnerBlocked,
    snapshotOwnerMismatchFailsAtSecurityBoundary: snapshotOwnerBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    staleKnownSource,
    missingMaterial,
    bindingMismatch,
    providerAuthorityClosure,
    providerSelfGlobal,
    overlappingIdentity,
  };
}
