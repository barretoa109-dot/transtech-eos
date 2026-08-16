import {
  sha256FinancialFingerprint,
  stableFinancialFingerprintMaterial,
} from "./persistence-fingerprint";
import type {
  MultiProviderGlobalContextPlan,
  MultiProviderScopedPersistencePlan,
  MultiProviderScopedProviderPlan,
} from "./multi-provider-scoped-persistence";

export interface MultiProviderGlobalContextCommitProviderBinding {
  providerKey: string;
  scopeFingerprint: string;
  snapshotFingerprint: string;
  providerPlanFingerprint: string;
}

export interface MultiProviderGlobalContextCommit {
  version: "multi-provider-global-context-commit-v1";
  userId: string;
  commitFingerprint: string;
  manifestFingerprint: string;
  globalContextRevision: string;
  globalContextFingerprint: string;
  globalCoverageFingerprint: string;
  sourceOrchestrationFingerprint: string;
  analysisFingerprint: string;
  globalResultFingerprint: string;
  providerBindings: MultiProviderGlobalContextCommitProviderBinding[];
  committedAt: string;
}

function canonicalIso(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    throw new Error("financial_global_context_commit_invalid_committed_at");
  }
  return new Date(time).toISOString();
}

export function globalContextCommitProviderBindings(
  providerPlans: MultiProviderScopedProviderPlan[],
) {
  return providerPlans
    .map((plan) => ({
      providerKey: plan.providerKey,
      scopeFingerprint: plan.scopeFingerprint,
      snapshotFingerprint: plan.snapshotFingerprint,
      providerPlanFingerprint: plan.providerPlanFingerprint,
    }))
    .sort((a, b) =>
      `${a.providerKey}:${a.scopeFingerprint}`.localeCompare(
        `${b.providerKey}:${b.scopeFingerprint}`,
      ),
    );
}

export function globalContextCommitFingerprint(input: {
  userId: string;
  manifestFingerprint: string;
  globalContextRevision: string;
  globalContextFingerprint: string;
  globalCoverageFingerprint: string;
  sourceOrchestrationFingerprint: string;
  analysisFingerprint: string;
  globalResultFingerprint: string;
  providerBindings: MultiProviderGlobalContextCommitProviderBinding[];
  committedAt: string;
}) {
  return sha256FinancialFingerprint({
    contract: "multi-provider-global-context-commit-v1",
    trustedUserId: input.userId,
    manifestFingerprint: input.manifestFingerprint,
    globalContextRevision: input.globalContextRevision,
    globalContextFingerprint: input.globalContextFingerprint,
    globalCoverageFingerprint: input.globalCoverageFingerprint,
    sourceOrchestrationFingerprint: input.sourceOrchestrationFingerprint,
    analysisFingerprint: input.analysisFingerprint,
    globalResultFingerprint: input.globalResultFingerprint,
    providerBindings: input.providerBindings,
    committedAt: canonicalIso(input.committedAt),
  });
}

export function buildMultiProviderGlobalContextCommit(input: {
  trustedUserId: string;
  globalContext: MultiProviderGlobalContextPlan;
  providerPlans: MultiProviderScopedProviderPlan[];
}): MultiProviderGlobalContextCommit {
  if (input.globalContext.userId !== input.trustedUserId) {
    throw new Error("financial_global_context_commit_user_mismatch");
  }

  const providerBindings = globalContextCommitProviderBindings(
    input.providerPlans,
  );
  const committedAt = canonicalIso(input.globalContext.generatedAt);
  const material = {
    userId: input.trustedUserId,
    manifestFingerprint: input.globalContext.manifestFingerprint,
    globalContextRevision: input.globalContext.revision,
    globalContextFingerprint: input.globalContext.sourceFingerprint,
    globalCoverageFingerprint: input.globalContext.globalCoverageFingerprint,
    sourceOrchestrationFingerprint:
      input.globalContext.sourceOrchestrationFingerprint,
    analysisFingerprint: input.globalContext.analysisFingerprint,
    globalResultFingerprint: input.globalContext.globalResultFingerprint,
    providerBindings,
    committedAt,
  };

  return {
    version: "multi-provider-global-context-commit-v1",
    ...material,
    commitFingerprint: globalContextCommitFingerprint(material),
  };
}

export function buildMultiProviderGlobalContextCommitFromPlan(input: {
  trustedUserId: string;
  plan: MultiProviderScopedPersistencePlan;
}) {
  if (input.plan.userId !== input.trustedUserId) {
    throw new Error("financial_global_context_commit_user_mismatch");
  }
  if (!input.plan.globalContextPlan) {
    if (input.plan.manifest.globalContextEligible) {
      throw new Error("financial_global_context_commit_missing_context");
    }
    return null;
  }
  if (!input.plan.manifest.globalContextEligible) {
    throw new Error("financial_global_context_commit_unexpected_context");
  }

  return buildMultiProviderGlobalContextCommit({
    trustedUserId: input.trustedUserId,
    globalContext: input.plan.globalContextPlan,
    providerPlans: input.plan.providerPlans,
  });
}

export function globalContextCommitMatches(input: {
  trustedUserId: string;
  commit: MultiProviderGlobalContextCommit;
  globalContext: MultiProviderGlobalContextPlan;
  providerPlans: MultiProviderScopedProviderPlan[];
}) {
  const expected = buildMultiProviderGlobalContextCommit({
    trustedUserId: input.trustedUserId,
    globalContext: input.globalContext,
    providerPlans: input.providerPlans,
  });

  return (
    stableFinancialFingerprintMaterial(input.commit) ===
    stableFinancialFingerprintMaterial(expected)
  );
}
