import {
  CRITICAL_OBLIGATIONS_COMPLETENESS_PREFIX,
  buildFinancialPersistencePlanV1_2,
  type FinancialContextInsertV1_2,
  type FinancialPersistencePlanV1_2,
} from "./critical-obligations-persistence";
import { FINANCIAL_CONTEXT_INTEGRITY_PREFIX } from "./financial-context-integrity";
import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { TrustedSourceCoverageResolution } from "./source-coverage";
import type { FinancialConnectorSnapshot } from "./types";
import type { ZeroEntryAutopilotResult } from "./zero-entry";

const SHA256_HEX = /^[a-f0-9]{64}$/;
export const SOURCE_COVERAGE_EVIDENCE_PREFIX = "source-coverage-evidence:";
export const CRITICAL_SOURCES_COMPLETENESS_PREFIX =
  "critical-sources-completeness:";

export interface FinancialContextInsertV1_3 extends FinancialContextInsertV1_2 {
  criticalSourcesComplete: boolean;
}

export interface FinancialPersistencePlanV1_3
  extends Omit<FinancialPersistencePlanV1_2, "contextInsert"> {
  contextInsert: FinancialContextInsertV1_3;
}

export type PersistableSourceCoverageEvidence = Pick<
  TrustedSourceCoverageResolution,
  "criticalSourcesComplete" | "inventoryFingerprint" | "coverageValidUntil"
>;

function exactlyOneRef(explanationRefs: string[], prefix: string, code: string) {
  const refs = explanationRefs.filter((ref) => ref.startsWith(prefix));
  if (refs.length !== 1) throw new Error(code);
  return refs[0];
}

function validIso(value: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function earlierIso(a: string, b: string) {
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) {
    throw new Error("financial_persistence_invalid_source_coverage_evidence");
  }
  return new Date(Math.min(aTime, bTime)).toISOString();
}

function resultBoundedByCoverageEvidence(
  result: ZeroEntryAutopilotResult,
): ZeroEntryAutopilotResult {
  const coverageValidUntil = validIso(result.sourceCoverage.coverageValidUntil);
  if (!coverageValidUntil) return result;

  // The base persistence builder derives context validUntil from the primary
  // horizon + connector freshness before v1.1 creates its aggregate integrity
  // commitment. Bound that input *before* v1.1 hashing; never mutate validUntil
  // after the context-integrity ref has been created.
  const boundedPersistenceHorizon = earlierIso(
    result.primaryHorizon.until,
    coverageValidUntil,
  );
  if (boundedPersistenceHorizon === result.primaryHorizon.until) return result;

  return {
    ...result,
    primaryHorizon: {
      ...result.primaryHorizon,
      until: boundedPersistenceHorizon,
    },
  };
}

export function parsePersistedCriticalSourcesComplete(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("financial_state_invalid_critical_sources_complete");
  }
  return value;
}

export function sourceCoverageEvidenceRef(
  coverage: PersistableSourceCoverageEvidence,
) {
  return `${SOURCE_COVERAGE_EVIDENCE_PREFIX}${sha256FinancialFingerprint({
    contract: "source-coverage-evidence-v1.3",
    inventoryFingerprint: coverage.inventoryFingerprint,
    coverageValidUntil: coverage.coverageValidUntil,
  })}`;
}

export function criticalSourcesCompletenessRef(input: {
  criticalSourcesComplete: boolean;
  contextIntegrityRef: string;
  criticalObligationsCompletenessRef: string;
  sourceCoverageEvidenceRef: string;
}) {
  return `${CRITICAL_SOURCES_COMPLETENESS_PREFIX}${sha256FinancialFingerprint({
    contract: "critical-sources-completeness-v1.3",
    contextIntegrityRef: input.contextIntegrityRef,
    criticalObligationsCompletenessRef:
      input.criticalObligationsCompletenessRef,
    sourceCoverageEvidenceRef: input.sourceCoverageEvidenceRef,
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
  const sourceCoverageEvidenceRef = exactlyOneRef(
    input.explanationRefs,
    SOURCE_COVERAGE_EVIDENCE_PREFIX,
    "financial_state_source_coverage_evidence_ref_missing",
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
        sourceCoverageEvidenceRef,
      })
  );
}

/**
 * v1.3 separates source freshness from source coverage. The hard boolean is no
 * longer accepted as a free-standing assertion: persistence receives compact
 * evidence produced by the trusted source-coverage resolver and binds its
 * fingerprint/lifetime into the v1.3 revision.
 */
export function upgradeFinancialPersistencePlanWithCriticalSources(input: {
  plan: FinancialPersistencePlanV1_2;
  sourceCoverage: PersistableSourceCoverageEvidence;
}): FinancialPersistencePlanV1_3 {
  const coverage = input.sourceCoverage;
  if (typeof coverage.criticalSourcesComplete !== "boolean") {
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
  if (
    !coverage.criticalSourcesComplete &&
    input.plan.contextInsert.status !== "DEGRADED"
  ) {
    throw new Error("financial_persistence_critical_sources_conflict_with_status");
  }

  const normalizedCoverageValidUntil = validIso(coverage.coverageValidUntil);
  const generatedAtTime = new Date(input.plan.contextInsert.generatedAt).getTime();
  const coverageValidUntilTime = normalizedCoverageValidUntil
    ? new Date(normalizedCoverageValidUntil).getTime()
    : Number.NaN;
  const contextValidUntilTime = new Date(input.plan.contextInsert.validUntil).getTime();
  if (
    (coverage.inventoryFingerprint !== null &&
      !SHA256_HEX.test(coverage.inventoryFingerprint)) ||
    (coverage.coverageValidUntil !== null && normalizedCoverageValidUntil === null) ||
    (coverage.criticalSourcesComplete &&
      (!coverage.inventoryFingerprint ||
        normalizedCoverageValidUntil === null ||
        !Number.isFinite(generatedAtTime) ||
        !Number.isFinite(contextValidUntilTime) ||
        coverageValidUntilTime <= generatedAtTime ||
        contextValidUntilTime > coverageValidUntilTime))
  ) {
    throw new Error("financial_persistence_invalid_source_coverage_evidence");
  }

  const normalizedCoverage: PersistableSourceCoverageEvidence = {
    criticalSourcesComplete: coverage.criticalSourcesComplete,
    inventoryFingerprint: coverage.inventoryFingerprint,
    coverageValidUntil: normalizedCoverageValidUntil,
  };
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
  const evidenceRef = sourceCoverageEvidenceRef(normalizedCoverage);
  const completenessRef = criticalSourcesCompletenessRef({
    criticalSourcesComplete: coverage.criticalSourcesComplete,
    contextIntegrityRef,
    criticalObligationsCompletenessRef,
    sourceCoverageEvidenceRef: evidenceRef,
  });
  const explanationRefs = [
    ...input.plan.contextInsert.explanationRefs.filter(
      (ref) =>
        !ref.startsWith(CRITICAL_SOURCES_COMPLETENESS_PREFIX) &&
        !ref.startsWith(SOURCE_COVERAGE_EVIDENCE_PREFIX),
    ),
    evidenceRef,
    completenessRef,
  ].sort();
  const sourceFingerprint = sha256FinancialFingerprint({
    contract: "financial-context-critical-sources-v1.3",
    v1_2Fingerprint: input.plan.contextInsert.sourceFingerprint,
    evidenceRef,
    completenessRef,
  });

  return {
    ...input.plan,
    contextInsert: {
      ...input.plan.contextInsert,
      sourceFingerprint,
      revision: `ctx:${sourceFingerprint}`,
      explanationRefs,
      criticalSourcesComplete: coverage.criticalSourcesComplete,
    },
  };
}

export function buildFinancialPersistencePlanV1_3(input: {
  snapshot: FinancialConnectorSnapshot;
  result: ZeroEntryAutopilotResult;
}): FinancialPersistencePlanV1_3 {
  const boundedResult = resultBoundedByCoverageEvidence(input.result);
  const plan = buildFinancialPersistencePlanV1_2({
    snapshot: input.snapshot,
    result: boundedResult,
  });
  return upgradeFinancialPersistencePlanWithCriticalSources({
    plan,
    sourceCoverage: input.result.sourceCoverage,
  });
}
