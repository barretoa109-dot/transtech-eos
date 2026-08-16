import {
  TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
  aggregateTrustedGlobalSourceCoverage,
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  resolveTrustedSourceCoverage,
  type TrustedFinancialSourceInventory,
} from "./source-coverage";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000126";
const NOW = "2026-08-16T18:45:00.000Z";
const VALID_UNTIL = "2026-08-17T12:00:00.000Z";

function buildBundle(): TrustedScopedSourceBundle {
  const account: FinancialAccount = {
    id: "20000000-0000-4000-8000-000000000126",
    userId: USER_ID,
    externalAccountId: "temporal-checking",
    connectionId: "temporal-connection",
    type: "checking",
    institutionName: "Temporal Fixture Bank",
    displayName: "Temporal checking",
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 5000000,
    ledgerBalanceMinor: 5000000,
    balanceAsOf: NOW,
    freshUntil: VALID_UNTIL,
  };
  const snapshot: FinancialConnectorSnapshot = {
    providerKey: "provider-temporal",
    fetchedAt: NOW,
    accounts: [account],
    ledgerEntries: [],
  };
  const inventory: TrustedFinancialSourceInventory = {
    version: TRUSTED_SOURCE_INVENTORY_VERSION,
    userId: USER_ID,
    asOf: NOW,
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
          providerKey: snapshot.providerKey,
          account,
        }),
        materiality: "critical",
        confidence: 0.99,
      },
    ],
  };
  return { snapshot, inventory };
}

function fingerprint(bundle: TrustedScopedSourceBundle) {
  const resolution = resolveTrustedSourceCoverage({
    trustedUserId: USER_ID,
    snapshot: bundle.snapshot,
    inventory: bundle.inventory,
    nowIso: NOW,
  });
  if (!resolution.inventoryFingerprint) {
    throw new Error("temporal global coverage fixture missing fingerprint");
  }
  return resolution.inventoryFingerprint;
}

function closure(
  bundle: TrustedScopedSourceBundle,
  asOf: string,
): TrustedGlobalSourceClosure {
  return {
    version: TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
    userId: USER_ID,
    asOf,
    validUntil: VALID_UNTIL,
    authority: "user_confirmed",
    confidence: 0.99,
    confirmsNoOtherMaterialSources: true,
    coveredInventoryFingerprints: [fingerprint(bundle)],
  };
}

export function runGlobalSourceCoverageTemporalScenario() {
  const bundle = buildBundle();
  const exactBoundary = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: [bundle],
    closure: closure(bundle, NOW),
    nowIso: NOW,
  });
  const predatesLeaf = aggregateTrustedGlobalSourceCoverage({
    trustedUserId: USER_ID,
    bundles: [bundle],
    closure: closure(bundle, "2026-08-16T18:44:59.999Z"),
    nowIso: NOW,
  });

  const checks = {
    closureAtLeafEvidenceBoundaryIsAllowed:
      exactBoundary.criticalSourcesComplete &&
      exactBoundary.reasonCodes.length === 0,
    closureCannotPreDateEvidenceItClaimsToBind:
      !predatesLeaf.criticalSourcesComplete &&
      predatesLeaf.reasonCodes.includes("global_closure_predates_evidence"),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    exactBoundary,
    predatesLeaf,
  };
}
