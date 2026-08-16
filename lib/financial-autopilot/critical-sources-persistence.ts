import {
  CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX,
  buildFinancialPersistencePlanV1_2,
  type FinancialContextInsertV1_2,
  type FinancialPersistencePlanV1_2,
} from "./critical-obligations-persistence";
import { FINANCIAL_CONTEXT_INTEGRITY_PREFIX } from "./financial-context-integrity";
import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { FinancialConnectorSnapshot } from "./types";
import type { ZeroEntryAutopilotResult } from "./zero-entry";

const SHA256_HEX = /^[a-f0-9]{64}$/;
export const CRITICAL_SOURCES_COMPLETENESS_PREFIX =
  "critical-sources-completeness:";

export interface FinancialContextInsertV1_3 extends FinancialContextInsertV1_2 {
  criticalSourcesComplete: boolean;
}

export interface FinancialPersistencePlanV1_3
  extends Omit<FinancialPersistencePlanV1_2, "contextInsert"> {
  contextInsert: FinancialContextInsertV1_3;
}

function exactlyOneRef(explanationRefs: string[], prefix: string, code: string) {
  const refs = explanationRefs.filter((ref) => ref.startsWith(prefix));
  if (refs.length !== 1) throw new Error(code);
  return refs[0];
}

export function parsePersistedCriticalSourcesComplete(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("financial_state_invalid_critical_sources_complete");
  }
  return value;
}

export function criticalSourcesCompletenessRef(input: {
  criticalSourcesComplete: boolean;
  contextIntegrityRef: string;
  criticalObligationsCompletenessRef: string;
}) {
  return `${CRITICAL_SOURCES_COMPLETENESS_PREFIX}${sha256FinancialFingerprint({
    contract: "critical-sources-completeness-v1.3",
    contextIntegrityRef: input.contextIntegrityRef,
    criticalObligationsCompletenessRef:
      input.criticalObligationsCompletenessRef,
    criticalSourcesComplete: input.criticalSourcesComplete,
  })}`;
}

export function criticalSourcesCompletenessMatches(input: {
  criticalSourcesComplete: boolean;
  explanationRefs: string[];
}) {
  const contextIntegrityRef = exactlyOneRef(
    input.explanationRefs,
    FINANCIAL_CONTEXT_INTEGRITY_PREFIX,
    "financial_state_context_integrity_ref_missing",
  );
  const criticalObligationsCompletenessRef = exactlyOneRef(
    input.explanationRefs,
    CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX,
    "financial_state_critical_obligations_ref_missing",
  );
  const persisted = input.explanationRefs.filter((ref) =>
    ref.startsWith(CRITICAL_SOURCES_COMPLETENESS_PREFIX),
  );

  return (
    persisted.length === 1 &&
    persisted[0] ===
      criticalSourcesCompletenessRef({
        criticalSourcesComplete: input.criticalSourcesComplete,
        contextIntegrityRef,
        criticalObligationsCompletenessRef,
      })
  );
}

/**
 * v1.3 separates source freshness from source coverage. A perfectly fresh
 * connected account is not enough to claim SAFE if EOS does not know whether
 * another material account/card/loan/source is missing. The trusted source
 * registry supplies this explicit hard boolean; this layer commits it to the
 * already integrity-bound v1.2 context and to the v1.3 revision identity.
 */
export function upgradeFinancialPersistencePlanWithCriticalSources(input: {
  plan: FinancialPersistencePlanV1_2;
  criticalSourcesComplete: boolean;
}): FinancialPersistencePlanV1_3 {
  if (typeof input.criticalSourcesComplete !== "boolean") {
    throw new Error("financial_persistence_invalid_critical_sources_complete");
  }
  if (
    input.plan.contextInsert.userId !== input.plan.userId ||
    !SHA256_HEX.test(input.plan.contextInsert.sourceFingerprint) ||
    input.plan.contextInsert.revision !==
      `ctx:${input.plan.contextInsert.sourceFingerprint}`
  ) {
    throw new Error("financial_persistence_invalid_v1_2_context_identity");
  }
  if (!input.criticalSourcesComplete && input.plan.contextInsert.status !== "DEGRADED") {
    throw new Error("financial_persistence_critical_sources_conflict_with_status");
  }

  const contextIntegrityRef = exactlyOneRef(
    input.plan.contextInsert.explanationRefs,
    FINANCIAL_CONTEXT_INTEGRITY_PREFIX,
    "financial_persistence_context_integrity_ref_missing",
  );
  const criticalObligationsCompletenessRef = exactlyOneRef(
    input.plan.contextInsert.explanationRefs,
    CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX,
    "financial_persistence_critical_obligations_ref_missing",
  );
  const completenessRef = criticalSourcesCompletenessRef({
    criticalSourcesComplete: input.criticalSourcesComplete,
    contextIntegrityRef,
    criticalObligationsCompletenessRef,
  });
  const explanationRefs = [
    ...input.plan.contextInsert.explanationRefs.filter(
      (ref) => !ref.startsWith(CRITICAL_SOURCES_COMPLETENESS_PREFIX),
    ),
    completenessRef,
  ].sort();
  const sourceFingerprint = sha256FinancialFingerprint({
    contract: "financial-context-critical-sources-v1.3",
    v1_2Fingerprint: input.plan.contextInsert.sourceFingerprint,
    completenessRef,
  });

  return {
    ...input.plan,
    contextInsert: {
      ...input.plan.contextInsert,
      sourceFingerprint,
      revision: `ctx:${sourceFingerprint}`,
      explanationRefs,
      criticalSourcesComplete: input.criticalSourcesComplete,
    },
  };
}

export function buildFinancialPersistencePlanV1_3(input: {
  snapshot: FinancialConnectorSnapshot;
  result: ZeroEntryAutopilotResult;
}): FinancialPersistencePlanV1_3 {
  const plan = buildFinancialPersistencePlanV1_2(input);
  return upgradeFinancialPersistencePlanWithCriticalSources({
    plan,
    criticalSourcesComplete: input.result.resolvedInputs.criticalSourcesComplete,
  });
}
