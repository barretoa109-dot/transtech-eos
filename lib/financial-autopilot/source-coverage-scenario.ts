import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  financialSourceCoverageRef,
  resolveTrustedSourceCoverage,
  type ExpectedFinancialSourceEvidence,
  type TrustedFinancialSourceInventory,
} from "./source-coverage";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000102";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000103";
const NOW = "2026-08-16T18:00:00.000Z";
const PROVIDER = "mock_source_coverage_py_v1";

function account(
  id: string,
  externalAccountId: string,
  patch: Partial<FinancialAccount> = {},
): FinancialAccount {
  return {
    id,
    userId: USER_ID,
    externalAccountId,
    connectionId: "source-coverage-connection",
    type: "checking",
    institutionName: "Coverage Fixture Bank",
    displayName: id,
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 1000000,
    ledgerBalanceMinor: 1000000,
    balanceAsOf: NOW,
    freshUntil: "2026-08-17T18:00:00.000Z",
    ...patch,
  };
}

function snapshot(accounts: FinancialAccount[]): FinancialConnectorSnapshot {
  return {
    providerKey: PROVIDER,
    fetchedAt: NOW,
    accounts,
    ledgerEntries: [],
  };
}

function sourceEvidence(
  sourceRef: string,
  materiality: ExpectedFinancialSourceEvidence["materiality"] = "material",
  confidence = 0.99,
): ExpectedFinancialSourceEvidence {
  return { sourceRef, materiality, confidence };
}

function inventory(
  expectedSources: ExpectedFinancialSourceEvidence[],
  patch: Partial<TrustedFinancialSourceInventory> = {},
): TrustedFinancialSourceInventory {
  return {
    version: TRUSTED_SOURCE_INVENTORY_VERSION,
    userId: USER_ID,
    asOf: NOW,
    validUntil: "2026-08-17T18:00:00.000Z",
    authority: "provider_discovery",
    discoveryComplete: true,
    confidence: 0.98,
    unresolvedMaterialSourceCount: 0,
    expectedSources,
    ...patch,
  };
}

function refFor(accountValue: FinancialAccount) {
  return financialAccountSourceCoverageRef({
    userId: USER_ID,
    providerKey: PROVIDER,
    account: accountValue,
  });
}

function missingRef(externalAccountId: string) {
  return financialSourceCoverageRef({
    userId: USER_ID,
    providerKey: PROVIDER,
    connectionId: "source-coverage-connection",
    externalAccountId,
  });
}

function catchesCode(work: () => unknown, code: string) {
  try {
    work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

export function runTrustedSourceCoverageScenario() {
  const checking = account("checking", "checking-001");
  const card = account("card", "card-001", { type: "card" });
  const connected = snapshot([checking, card]);
  const expected = [
    sourceEvidence(refFor(checking), "critical"),
    sourceEvidence(refFor(card), "material"),
    sourceEvidence(missingRef("optional-loan-001"), "optional"),
  ];

  const healthy = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory(expected),
    nowIso: NOW,
  });
  const reordered = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: snapshot([card, checking]),
    inventory: inventory([...expected].reverse()),
    nowIso: NOW,
  });
  const missingMaterial = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory([
      ...expected,
      sourceEvidence(missingRef("wallet-material-001"), "material"),
    ]),
    nowIso: NOW,
  });
  const unresolvedHint = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory(expected, { unresolvedMaterialSourceCount: 1 }),
    nowIso: NOW,
  });
  const incompleteDiscovery = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory(expected, { discoveryComplete: false }),
    nowIso: NOW,
  });
  const lowInventoryConfidence = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory(expected, { confidence: 0.89 }),
    nowIso: NOW,
  });
  const staleInventory = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory(expected, {
      asOf: "2026-08-15T12:00:00.000Z",
      validUntil: NOW,
    }),
    nowIso: NOW,
  });
  const lowMaterialEvidence = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory([
      sourceEvidence(refFor(checking), "critical", 0.79),
      sourceEvidence(refFor(card), "material"),
    ]),
    nowIso: NOW,
  });
  const duplicateExpected = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory([
      sourceEvidence(refFor(checking), "critical"),
      sourceEvidence(refFor(checking), "material"),
      sourceEvidence(refFor(card), "material"),
    ]),
    nowIso: NOW,
  });
  const duplicateConnected = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: snapshot([
      checking,
      account("checking-copy", "checking-001"),
      card,
    ]),
    inventory: inventory(expected),
    nowIso: NOW,
  });
  const unknownOwnership = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: snapshot([
      { ...checking, ownership: "unknown" },
      card,
    ]),
    inventory: inventory(expected),
    nowIso: NOW,
  });
  const wrongProviderIdentity = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: connected,
    inventory: inventory([
      sourceEvidence(
        financialSourceCoverageRef({
          userId: USER_ID,
          providerKey: "different-provider",
          connectionId: checking.connectionId,
          externalAccountId: checking.externalAccountId,
        }),
        "critical",
      ),
      sourceEvidence(refFor(card), "material"),
    ]),
    nowIso: NOW,
  });
  const explicitlyEmptyInventory = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: snapshot([]),
    inventory: inventory([]),
    nowIso: NOW,
  });

  const crossUserAccountBlocked = catchesCode(
    () =>
      resolveTrustedSourceCoverage({
        trustedUserId: USER_ID,
        snapshot: snapshot([{ ...checking, userId: OTHER_USER_ID }]),
        inventory: inventory(expected),
        nowIso: NOW,
      }),
    "financial_source_coverage_account_owner_mismatch",
  );
  const crossUserInventoryBlocked = catchesCode(
    () =>
      resolveTrustedSourceCoverage({
        trustedUserId: USER_ID,
        snapshot: connected,
        inventory: inventory(expected, { userId: OTHER_USER_ID }),
        nowIso: NOW,
      }),
    "financial_source_coverage_inventory_owner_mismatch",
  );

  const checks = {
    trustedCompleteInventoryCanResolveComplete:
      healthy.criticalSourcesComplete &&
      healthy.expectedMaterialCount === 2 &&
      healthy.connectedMaterialCount === 2 &&
      healthy.missingMaterialCount === 0 &&
      healthy.reasonCodes.length === 0,
    optionalMissingSourceDoesNotBlockSafety: healthy.criticalSourcesComplete,
    identityAndFingerprintAreOrderIndependent:
      healthy.inventoryFingerprint !== null &&
      healthy.inventoryFingerprint === reordered.inventoryFingerprint &&
      reordered.criticalSourcesComplete,
    missingMaterialSourceFailsClosed:
      !missingMaterial.criticalSourcesComplete &&
      missingMaterial.missingMaterialCount === 1 &&
      missingMaterial.reasonCodes.includes("material_source_missing"),
    unresolvedMaterialHintFailsClosed:
      !unresolvedHint.criticalSourcesComplete &&
      unresolvedHint.reasonCodes.includes("unresolved_material_source"),
    incompleteDiscoveryFailsClosed:
      !incompleteDiscovery.criticalSourcesComplete &&
      incompleteDiscovery.reasonCodes.includes("inventory_discovery_incomplete"),
    weakInventoryAuthorityConfidenceFailsClosed:
      !lowInventoryConfidence.criticalSourcesComplete &&
      lowInventoryConfidence.reasonCodes.includes(
        "inventory_confidence_below_threshold",
      ),
    expiredInventoryFailsClosed:
      !staleInventory.criticalSourcesComplete &&
      staleInventory.reasonCodes.includes("inventory_not_current"),
    weakMaterialEvidenceFailsClosed:
      !lowMaterialEvidence.criticalSourcesComplete &&
      lowMaterialEvidence.reasonCodes.includes(
        "material_source_evidence_below_threshold",
      ),
    duplicateExpectedIdentityFailsClosed:
      !duplicateExpected.criticalSourcesComplete &&
      duplicateExpected.reasonCodes.includes("duplicate_expected_source_identity"),
    duplicateConnectedIdentityFailsClosed:
      !duplicateConnected.criticalSourcesComplete &&
      duplicateConnected.reasonCodes.includes("duplicate_connected_source_identity"),
    unknownOwnershipCannotSatisfyCoverage:
      !unknownOwnership.criticalSourcesComplete &&
      unknownOwnership.reasonCodes.includes("material_source_missing"),
    sourceIdentityIsProviderScoped:
      !wrongProviderIdentity.criticalSourcesComplete &&
      wrongProviderIdentity.reasonCodes.includes("material_source_missing"),
    explicitEmptyInventoryCanBeCompleteAtCoverageLayer:
      explicitlyEmptyInventory.criticalSourcesComplete &&
      explicitlyEmptyInventory.expectedMaterialCount === 0 &&
      explicitlyEmptyInventory.connectedSourceCount === 0,
    crossUserAccountFailsAtSecurityBoundary: crossUserAccountBlocked,
    crossUserInventoryFailsAtSecurityBoundary: crossUserInventoryBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    missingMaterial,
    unresolvedHint,
    staleInventory,
  };
}
