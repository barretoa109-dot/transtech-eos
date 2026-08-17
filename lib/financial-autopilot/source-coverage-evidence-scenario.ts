import { buildSourceCoverageEvidenceV1, sourceCoverageResolutionFromEvidence } from "./source-coverage-evidence";
import type { TrustedSourceCoverageResolution } from "./source-coverage";

const USER = "00000000-0000-4000-8000-000000000071";
const FP = "b".repeat(64);
const VALID = "2026-08-18T03:00:00.000Z";
function resolution(overrides: Partial<TrustedSourceCoverageResolution> = {}): TrustedSourceCoverageResolution { return { criticalSourcesComplete: true, criticalSourcesFresh: true, expectedMaterialCount: 2, connectedMaterialCount: 2, missingMaterialCount: 0, staleConnectedSourceCount: 0, connectedSourceCount: 2, reasonCodes: [], freshnessReasonCodes: [], inventoryFingerprint: FP, coverageValidUntil: VALID, ...overrides }; }
function rejects(run: () => unknown, code: string) { try { run(); return false; } catch (error) { return error instanceof Error && error.message === code; } }

export function runSourceCoverageEvidenceScenario() {
  const evidence = buildSourceCoverageEvidenceV1({ trustedUserId: USER, inventoryFingerprint: FP, resolvedAt: "2026-08-17T03:00:00.000Z", validUntil: VALID, resolution: resolution() });
  const restored = sourceCoverageResolutionFromEvidence({ trustedUserId: USER, evidence, expectedInventoryFingerprint: FP, nowIso: "2026-08-17T04:00:00.000Z" });
  const expired = sourceCoverageResolutionFromEvidence({ trustedUserId: USER, evidence, expectedInventoryFingerprint: FP, nowIso: VALID });
  const checks = {
    completeEvidenceRoundTrips: restored?.criticalSourcesComplete === true && restored.connectedMaterialCount === 2,
    expiredEvidenceReturnsNull: expired === null,
    falseCompleteRejected: rejects(() => buildSourceCoverageEvidenceV1({ trustedUserId: USER, inventoryFingerprint: FP, resolvedAt: "2026-08-17T03:00:00.000Z", validUntil: VALID, resolution: resolution({ missingMaterialCount: 1, connectedMaterialCount: 1 }) }), "financial_coverage_evidence_false_complete"),
    inventoryMismatchRejected: rejects(() => sourceCoverageResolutionFromEvidence({ trustedUserId: USER, evidence, expectedInventoryFingerprint: "c".repeat(64), nowIso: "2026-08-17T04:00:00.000Z" }), "financial_coverage_evidence_owner_or_inventory_mismatch"),
    tamperRejected: rejects(() => sourceCoverageResolutionFromEvidence({ trustedUserId: USER, evidence: { ...evidence, connectedMaterialCount: 1 }, expectedInventoryFingerprint: FP, nowIso: "2026-08-17T04:00:00.000Z" }), "financial_coverage_evidence_fingerprint_mismatch"),
    evidenceNeverGrantsSafety: !("canAssertSafety" in evidence),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
