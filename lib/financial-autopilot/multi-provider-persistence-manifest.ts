import {
  type TrustedGlobalSourceClosure,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import { orchestrateTrustedGlobalFinancialSources } from "./global-source-orchestration";
import {
  financialLedgerCanonicalKey,
  sha256FinancialFingerprint,
} from "./persistence";
import { financialAccountSourceCoverageRef } from "./source-coverage";
import type { GlobalZeroEntryAutopilotResult } from "./zero-entry";

export interface MultiProviderPersistenceScopeManifest {
  providerKey: string;
  fetchedAt: string;
  snapshotFingerprint: string;
  accountSourceRefs: string[];
  ledgerCanonicalKeys: string[];
  scopeFingerprint: string;
}

export interface MultiProviderPersistenceManifest {
  version: "multi-provider-persistence-manifest-v1";
  trustedUserId: string;
  providerScopes: MultiProviderPersistenceScopeManifest[];
  analysisFingerprint: string;
  globalCoverageFingerprint: string | null;
  sourceOrchestrationFingerprint: string | null;
  globalResultFingerprint: string;
  /** Raw provider ingestion may proceed separately; global context requires this true. */
  globalContextEligible: boolean;
  manifestFingerprint: string;
}

function canonicalProviderKey(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new Error("financial_multi_provider_manifest_invalid_provider_key");
  }
  return normalized;
}

/**
 * Produces a compact, deterministic hand-off for the future scoped persistence
 * layer. It writes nothing. The manifest proves which original provider
 * snapshots, canonical Ledger identities and global Zero Entry result belong to
 * the same orchestration.
 */
export function buildMultiProviderPersistenceManifest(input: {
  trustedUserId: string;
  bundles: TrustedScopedSourceBundle[];
  globalSourceClosure: TrustedGlobalSourceClosure;
  result: GlobalZeroEntryAutopilotResult;
  nowIso: string;
}): MultiProviderPersistenceManifest {
  if (input.result.analysisScope !== "multi_provider") {
    throw new Error("financial_multi_provider_manifest_requires_global_result");
  }

  const orchestration = orchestrateTrustedGlobalFinancialSources({
    trustedUserId: input.trustedUserId,
    bundles: input.bundles,
    closure: input.globalSourceClosure,
    nowIso: input.nowIso,
  });

  if (
    input.result.sourceOrchestrationFingerprint !==
      orchestration.orchestrationFingerprint ||
    input.result.sourceCoverage.inventoryFingerprint !==
      orchestration.coverage.inventoryFingerprint ||
    input.result.sourceCoverage.criticalSourcesComplete !==
      orchestration.coverage.criticalSourcesComplete ||
    input.result.sourceCoverage.criticalSourcesFresh !==
      orchestration.coverage.criticalSourcesFresh
  ) {
    throw new Error("financial_multi_provider_manifest_orchestration_mismatch");
  }

  const providerScopes = input.bundles.map((bundle) => {
    const providerKey = canonicalProviderKey(bundle.snapshot.providerKey);
    const accountsById = new Map(
      bundle.snapshot.accounts.map((account) => [account.id, account]),
    );
    const accountMaterial = bundle.snapshot.accounts
      .map((account) => ({
        sourceRef: financialAccountSourceCoverageRef({
          userId: input.trustedUserId,
          providerKey,
          account,
        }),
        account,
      }))
      .sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
    const ledgerMaterial = bundle.snapshot.ledgerEntries
      .map((entry) => {
        const account = accountsById.get(entry.accountId);
        if (!account) {
          throw new Error("financial_multi_provider_manifest_ledger_scope_mismatch");
        }
        const canonicalKey = financialLedgerCanonicalKey(entry, {
          providerKey,
          connectionKey: account.connectionId,
          externalAccountId: account.externalAccountId,
        });
        return { canonicalKey, entry };
      })
      .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
    const accountSourceRefs = accountMaterial.map((row) => row.sourceRef);
    const ledgerCanonicalKeys = ledgerMaterial.map((row) => row.canonicalKey);
    const snapshotFingerprint = sha256FinancialFingerprint({
      contract: "multi-provider-snapshot-persistence-material-v1",
      providerKey,
      fetchedAt: bundle.snapshot.fetchedAt,
      accounts: accountMaterial,
      ledgerEntries: ledgerMaterial,
    });
    const scopeFingerprint = sha256FinancialFingerprint({
      contract: "multi-provider-persistence-scope-v1",
      providerKey,
      snapshotFingerprint,
      accountSourceRefs,
      ledgerCanonicalKeys,
    });

    return {
      providerKey,
      fetchedAt: bundle.snapshot.fetchedAt,
      snapshotFingerprint,
      accountSourceRefs,
      ledgerCanonicalKeys,
      scopeFingerprint,
    } satisfies MultiProviderPersistenceScopeManifest;
  });

  providerScopes.sort((a, b) =>
    `${a.providerKey}:${a.scopeFingerprint}`.localeCompare(
      `${b.providerKey}:${b.scopeFingerprint}`,
    ),
  );

  if (
    new Set(providerScopes.map((scope) => scope.scopeFingerprint)).size !==
    providerScopes.length
  ) {
    throw new Error("financial_multi_provider_manifest_duplicate_scope");
  }

  const allLedgerCanonicalKeys = providerScopes.flatMap(
    (scope) => scope.ledgerCanonicalKeys,
  );
  if (new Set(allLedgerCanonicalKeys).size !== allLedgerCanonicalKeys.length) {
    throw new Error("financial_multi_provider_manifest_duplicate_ledger_identity");
  }

  const globalContextEligible =
    orchestration.coverage.criticalSourcesComplete &&
    orchestration.orchestrationFingerprint !== null;
  const globalResultFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-zero-entry-result-v1",
    analysisScope: input.result.analysisScope,
    sourceOrchestrationFingerprint: input.result.sourceOrchestrationFingerprint,
    sourceCoverageFingerprint: input.result.sourceCoverage.inventoryFingerprint,
    resolvedInputs: input.result.resolvedInputs,
    primaryHorizon: input.result.primaryHorizon,
    status: input.result.context.available.status,
    availableRealSafeMinor:
      input.result.context.available.availableRealSafeMinor,
    minimumProjectedCashMinor: input.result.context.minimumProjectedCashMinor,
    minimumProjectedCashAt: input.result.context.minimumProjectedCashAt,
    confidence: input.result.confidence,
    firstForecastRisk: input.result.horizons.firstRisk,
  });
  const manifestFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-persistence-manifest-v1",
    trustedUserId: input.trustedUserId,
    providerScopes: providerScopes.map((scope) => ({
      providerKey: scope.providerKey,
      scopeFingerprint: scope.scopeFingerprint,
    })),
    analysisFingerprint: orchestration.analysis.analysisFingerprint,
    globalCoverageFingerprint: orchestration.coverage.inventoryFingerprint,
    sourceOrchestrationFingerprint: orchestration.orchestrationFingerprint,
    globalResultFingerprint,
    globalContextEligible,
  });

  return {
    version: "multi-provider-persistence-manifest-v1",
    trustedUserId: input.trustedUserId,
    providerScopes,
    analysisFingerprint: orchestration.analysis.analysisFingerprint,
    globalCoverageFingerprint: orchestration.coverage.inventoryFingerprint,
    sourceOrchestrationFingerprint: orchestration.orchestrationFingerprint,
    globalResultFingerprint,
    globalContextEligible,
    manifestFingerprint,
  };
}
