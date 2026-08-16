import {
  aggregateTrustedGlobalSourceCoverage,
  type TrustedGlobalSourceClosure,
  type TrustedGlobalSourceCoverageResolution,
  type TrustedScopedSourceBundle,
} from "./global-source-coverage";
import {
  buildProviderPreservingFinancialAnalysisView,
  type ProviderPreservingFinancialAnalysisView,
} from "./multi-provider-analysis";
import { sha256FinancialFingerprint } from "./persistence-fingerprint";

export interface GlobalFinancialSourceOrchestrationResult {
  version: "global-financial-source-orchestration-v1";
  trustedUserId: string;
  coverage: TrustedGlobalSourceCoverageResolution;
  analysis: ProviderPreservingFinancialAnalysisView;
  /**
   * Present only when global coverage itself is structurally complete. Freshness
   * remains an independent safety gate and is committed through analysis material.
   */
  orchestrationFingerprint: string | null;
}

/**
 * Couples the exact provider snapshots used for analysis to the exact scoped
 * inventories used for global source coverage. This prevents a future caller
 * from proving coverage over one provider set while analyzing a different set.
 */
export function orchestrateTrustedGlobalFinancialSources(input: {
  trustedUserId: string;
  bundles: TrustedScopedSourceBundle[];
  closure: TrustedGlobalSourceClosure;
  nowIso: string;
}): GlobalFinancialSourceOrchestrationResult {
  const coverage = aggregateTrustedGlobalSourceCoverage(input);
  const analysis = buildProviderPreservingFinancialAnalysisView({
    trustedUserId: input.trustedUserId,
    snapshots: input.bundles.map((bundle) => bundle.snapshot),
    nowIso: input.nowIso,
  });

  const orchestrationFingerprint =
    coverage.criticalSourcesComplete &&
    coverage.inventoryFingerprint !== null &&
    coverage.closureFingerprint !== null
      ? sha256FinancialFingerprint({
          contract: "global-financial-source-orchestration-v1",
          trustedUserId: input.trustedUserId,
          coverageFingerprint: coverage.inventoryFingerprint,
          closureFingerprint: coverage.closureFingerprint,
          leafInventoryFingerprints: coverage.leafInventoryFingerprints,
          analysisFingerprint: analysis.analysisFingerprint,
        })
      : null;

  return {
    version: "global-financial-source-orchestration-v1",
    trustedUserId: input.trustedUserId,
    coverage,
    analysis,
    orchestrationFingerprint,
  };
}
