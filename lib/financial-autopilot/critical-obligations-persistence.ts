import {
  FINANCIAL_CONTEXT_INTEGRITY_PREFIX,
} from "./financial-context-integrity";
import {
  buildFinancialPersistencePlanV1_1,
  type FinancialContextInsertV1_1,
  type FinancialPersistencePlanV1_1,
} from "./first-forecast-risk-persistence";
import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { FinancialConnectorSnapshot } from "./types";
import type { ZeroEntryAutopilotResult } from "./zero-entry";

const SHA256_HEX = /^[a-f0-9]{64}$/;
export const CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX =
  "critical-obligations-completeness:";

export interface FinancialContextInsertV1_2 extends FinancialContextInsertV1_1 {
  criticalObligationsComplete: boolean;
}

export interface FinancialPersistencePlanV1_2
  extends Omit<FinancialPersistencePlanV1_1, "contextInsert"> {
  contextInsert: FinancialContextInsertV1_2;
}

function contextIntegrityRef(explanationRefs: string[]) {
  const refs = explanationRefs.filter((ref) =>
    ref.startsWith(FINANCIAL_CONTEXT_INTEGRITY_PREFIX),
  );
  if (refs.length !== 1) {
    throw new Error("financial_persistence_context_integrity_ref_missing");
  }
  return refs[0];
}

export function parsePersistedCriticalObligationsComplete(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("financial_state_invalid_critical_obligations_complete");
  }
  return value;
}

export function criticalObligationsCompletenessRef(input: {
  criticalObligationsComplete: boolean;
  contextIntegrityRef: string;
}) {
  return `${CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX}${sha256FinancialFingerprint({
    contract: "critical-obligations-completeness-v1.2",
    contextIntegrityRef: input.contextIntegrityRef,
    criticalObligationsComplete: input.criticalObligationsComplete,
  })}`;
}

export function criticalObligationsCompletenessMatches(input: {
  criticalObligationsComplete: boolean;
  explanationRefs: string[];
}) {
  const integrityRef = contextIntegrityRef(input.explanationRefs);
  const persisted = input.explanationRefs.filter((ref) =>
    ref.startsWith(CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX),
  );
  return (
    persisted.length === 1 &&
    persisted[0] ===
      criticalObligationsCompletenessRef({
        criticalObligationsComplete: input.criticalObligationsComplete,
        contextIntegrityRef: integrityRef,
      })
  );
}

/**
 * v1.2 makes critical-obligation completeness an explicit persisted safety
 * signal instead of inferring it from an aggregate confidence score. The
 * signal is committed to the already-integrity-bound aggregate context and to
 * the new revision identity. Production promotion remains gated on non-prod DB
 * validation of the v1.2 SQL wrapper.
 */
export function upgradeFinancialPersistencePlanWithCriticalObligations(input: {
  plan: FinancialPersistencePlanV1_1;
  criticalObligationsComplete: boolean;
}): FinancialPersistencePlanV1_2 {
  if (typeof input.criticalObligationsComplete !== "boolean") {
    throw new Error("financial_persistence_invalid_critical_obligations_complete");
  }
  if (
    input.plan.contextInsert.userId !== input.plan.userId ||
    !SHA256_HEX.test(input.plan.contextInsert.sourceFingerprint) ||
    input.plan.contextInsert.revision !==
      `ctx:${input.plan.contextInsert.sourceFingerprint}`
  ) {
    throw new Error("financial_persistence_invalid_v1_1_context_identity");
  }

  const aggregateIntegrityRef = contextIntegrityRef(
    input.plan.contextInsert.explanationRefs,
  );
  const completenessRef = criticalObligationsCompletenessRef({
    criticalObligationsComplete: input.criticalObligationsComplete,
    contextIntegrityRef: aggregateIntegrityRef,
  });
  const explanationRefs = [
    ...input.plan.contextInsert.explanationRefs.filter(
      (ref) => !ref.startsWith(CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX),
    ),
    completenessRef,
  ].sort();
  const sourceFingerprint = sha256FinancialFingerprint({
    contract: "financial-context-critical-obligations-v1.2",
    v1_1Fingerprint: input.plan.contextInsert.sourceFingerprint,
    completenessRef,
  });

  return {
    ...input.plan,
    contextInsert: {
      ...input.plan.contextInsert,
      sourceFingerprint,
      revision: `ctx:${sourceFingerprint}`,
      explanationRefs,
      criticalObligationsComplete: input.criticalObligationsComplete,
    },
  };
}

export function buildFinancialPersistencePlanV1_2(input: {
  snapshot: FinancialConnectorSnapshot;
  result: ZeroEntryAutopilotResult;
}): FinancialPersistencePlanV1_2 {
  const plan = buildFinancialPersistencePlanV1_1(input);
  return upgradeFinancialPersistencePlanWithCriticalObligations({
    plan,
    criticalObligationsComplete:
      input.result.resolvedInputs.criticalObligationsComplete,
  });
}
