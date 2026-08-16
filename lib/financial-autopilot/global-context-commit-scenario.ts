import {
  buildMultiProviderGlobalContextCommitFromPlan,
  globalContextCommitMatches,
} from "./global-context-commit";
import { runMultiProviderScopedPersistenceScenario } from "./multi-provider-scoped-persistence-scenario";

const USER_ID = "00000000-0000-4000-8000-000000000170";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000171";

export function runGlobalContextCommitScenario() {
  const scoped = runMultiProviderScopedPersistenceScenario();
  const healthyCommit = buildMultiProviderGlobalContextCommitFromPlan({
    trustedUserId: USER_ID,
    plan: scoped.healthy,
  });
  const reorderedCommit = scoped.healthy.globalContextPlan
    ? buildMultiProviderGlobalContextCommitFromPlan({
        trustedUserId: USER_ID,
        plan: {
          ...scoped.healthy,
          providerPlans: [...scoped.healthy.providerPlans].reverse(),
        },
      })
    : null;
  const degradedCommit = buildMultiProviderGlobalContextCommitFromPlan({
    trustedUserId: USER_ID,
    plan: scoped.stale,
  });
  const incompleteCommit = buildMultiProviderGlobalContextCommitFromPlan({
    trustedUserId: USER_ID,
    plan: scoped.incomplete,
  });

  let wrongUserBlocked = false;
  try {
    buildMultiProviderGlobalContextCommitFromPlan({
      trustedUserId: OTHER_USER_ID,
      plan: scoped.healthy,
    });
  } catch (error) {
    wrongUserBlocked =
      error instanceof Error &&
      error.message === "financial_global_context_commit_user_mismatch";
  }

  const tamperedCommit = healthyCommit
    ? { ...healthyCommit, commitFingerprint: "f".repeat(64) }
    : null;

  const checks = {
    healthyGlobalContextHasCommitMarker:
      healthyCommit !== null &&
      /^[a-f0-9]{64}$/.test(healthyCommit.commitFingerprint) &&
      healthyCommit.providerBindings.length === scoped.healthy.providerPlans.length,
    commitBindsExactGlobalContext:
      healthyCommit !== null &&
      scoped.healthy.globalContextPlan !== null &&
      healthyCommit.globalContextRevision ===
        scoped.healthy.globalContextPlan.revision &&
      healthyCommit.globalContextFingerprint ===
        scoped.healthy.globalContextPlan.sourceFingerprint,
    providerOrderingDoesNotChangeCommitIdentity:
      healthyCommit !== null &&
      reorderedCommit?.commitFingerprint === healthyCommit.commitFingerprint,
    incompleteCoverageHasNoAuthoritativeGlobalCommit:
      scoped.incomplete.globalContextPlan === null && incompleteCommit === null,
    degradedContextMayBeCommittedWithoutImplyingSafe:
      scoped.stale.globalContextPlan?.status === "DEGRADED" &&
      degradedCommit !== null,
    crossUserCommitConstructionFailsClosed: wrongUserBlocked,
    tamperedCommitDoesNotMatch:
      healthyCommit !== null &&
      tamperedCommit !== null &&
      scoped.healthy.globalContextPlan !== null &&
      !globalContextCommitMatches({
        trustedUserId: USER_ID,
        commit: tamperedCommit,
        globalContext: scoped.healthy.globalContextPlan,
        providerPlans: scoped.healthy.providerPlans,
      }),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthyCommit,
    degradedCommit,
  };
}
