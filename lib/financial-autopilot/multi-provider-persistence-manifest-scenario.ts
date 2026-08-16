import {
  TRUSTED_GLOBAL_SOURCE_CLOSURE_VERSION,
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import { buildMultiProviderPersistenceManifest } from "./multi-provider-persistence-manifest";
import {
  TRUSTED_SOURCE_INVENTORY_VERSION,
  financialAccountSourceCoverageRef,
  resolveTrustedSourceCoverage,
} from "./source-coverage";
import {
  buildZeroEntryFinancialAutopilotFromGlobalSources,
  type GlobalZeroEntryAutopilotResult,
} from "./zero-entry";
import type { FinancialAccount, FinancialConnectorSnapshot } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000160";
const AS_OF = "2026-08-16T19:00:00.000Z";
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

function bundle(providerKey: string, accountValue: FinancialAccount): TrustedScopedSourceBundle {
  const snapshot: FinancialConnectorSnapshot = {
    providerKey,
    fetchedAt: AS_OF,
    accounts: [accountValue],
    ledgerEntries: [],
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
            providerKey,
            account: accountValue,
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
    throw new Error("manifest fixture missing leaf fingerprint");
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

function result(
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

function catchesCode(work: () => unknown, code: string) {
  try {
    work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

export function runMultiProviderPersistenceManifestScenario() {
  const bankA = bundle(
    "provider-a",
    account({
      id: "20000000-0000-4000-8000-000000000160",
      connectionId: "connection-a",
      externalAccountId: "checking-a",
      amountMinor: 5000000,
    }),
  );
  const bankB = bundle(
    "provider-b",
    account({
      id: "20000000-0000-4000-8000-000000000161",
      connectionId: "connection-b",
      externalAccountId: "checking-b",
      amountMinor: 3000000,
    }),
  );
  const bundles = [bankA, bankB];
  const globalSourceClosure = closure(bundles);
  const globalResult = result(bundles, globalSourceClosure);
  const manifest = buildMultiProviderPersistenceManifest({
    trustedUserId: USER_ID,
    bundles,
    globalSourceClosure,
    result: globalResult,
    nowIso: AS_OF,
  });

  const reversedBundles = [...bundles].reverse();
  const reversedClosure = closure(reversedBundles);
  const reversedResult = result(reversedBundles, reversedClosure);
  const reversedManifest = buildMultiProviderPersistenceManifest({
    trustedUserId: USER_ID,
    bundles: reversedBundles,
    globalSourceClosure: reversedClosure,
    result: reversedResult,
    nowIso: AS_OF,
  });

  const tamperedResult = {
    ...globalResult,
    sourceCoverage: {
      ...globalResult.sourceCoverage,
      inventoryFingerprint: "b".repeat(64),
    },
  } as GlobalZeroEntryAutopilotResult;
  const tamperedResultBlocked = catchesCode(
    () =>
      buildMultiProviderPersistenceManifest({
        trustedUserId: USER_ID,
        bundles,
        globalSourceClosure,
        result: tamperedResult,
        nowIso: AS_OF,
      }),
    "financial_multi_provider_manifest_orchestration_mismatch",
  );

  const checks = {
    manifestKeepsTwoProviderScopes:
      manifest.providerScopes.length === 2 &&
      manifest.providerScopes.some((scope) => scope.providerKey === "provider-a") &&
      manifest.providerScopes.some((scope) => scope.providerKey === "provider-b"),
    providerScopeFingerprintsAreCompactAndDistinct:
      manifest.providerScopes.every((scope) =>
        /^[a-f0-9]{64}$/.test(scope.scopeFingerprint),
      ) &&
      new Set(manifest.providerScopes.map((scope) => scope.scopeFingerprint)).size === 2,
    globalContextIsBoundToExactOrchestration:
      manifest.globalContextEligible &&
      manifest.globalCoverageFingerprint ===
        globalResult.sourceCoverage.inventoryFingerprint &&
      manifest.sourceOrchestrationFingerprint ===
        globalResult.sourceOrchestrationFingerprint,
    manifestIdentityIsOrderIndependent:
      manifest.manifestFingerprint === reversedManifest.manifestFingerprint &&
      manifest.analysisFingerprint === reversedManifest.analysisFingerprint &&
      manifest.globalResultFingerprint === reversedManifest.globalResultFingerprint,
    resultSubstitutionFailsClosed: tamperedResultBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    manifest,
    tamperedResultBlocked,
  };
}
