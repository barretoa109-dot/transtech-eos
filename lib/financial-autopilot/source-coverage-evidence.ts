import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type {
  SourceCoverageReasonCode,
  SourceFreshnessReasonCode,
  TrustedSourceCoverageResolution,
} from "./source-coverage";

const SHA = /^[0-9a-f]{64}$/;

export interface SourceCoverageEvidenceV1 {
  version: "source-coverage-evidence-v1";
  userId: string;
  inventoryFingerprint: string;
  resolvedAt: string;
  validUntil: string;
  criticalSourcesComplete: boolean;
  criticalSourcesFresh: boolean;
  expectedMaterialCount: number;
  connectedMaterialCount: number;
  missingMaterialCount: number;
  staleConnectedSourceCount: number;
  connectedSourceCount: number;
  reasonCodes: SourceCoverageReasonCode[];
  freshnessReasonCodes: SourceFreshnessReasonCode[];
  fingerprint: string;
}

export function sourceCoverageEvidenceMaterial(
  evidence: Omit<SourceCoverageEvidenceV1, "fingerprint">,
) {
  return {
    version: evidence.version,
    userId: evidence.userId,
    inventoryFingerprint: evidence.inventoryFingerprint,
    resolvedAt: evidence.resolvedAt,
    validUntil: evidence.validUntil,
    criticalSourcesComplete: evidence.criticalSourcesComplete,
    criticalSourcesFresh: evidence.criticalSourcesFresh,
    expectedMaterialCount: evidence.expectedMaterialCount,
    connectedMaterialCount: evidence.connectedMaterialCount,
    missingMaterialCount: evidence.missingMaterialCount,
    staleConnectedSourceCount: evidence.staleConnectedSourceCount,
    connectedSourceCount: evidence.connectedSourceCount,
    reasonCodes: [...evidence.reasonCodes].sort(),
    freshnessReasonCodes: [...evidence.freshnessReasonCodes].sort(),
  };
}

function time(value: string, code: string) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

function count(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function buildSourceCoverageEvidenceV1(input: {
  trustedUserId: string;
  inventoryFingerprint: string;
  resolvedAt: string;
  validUntil: string;
  resolution: TrustedSourceCoverageResolution;
}): SourceCoverageEvidenceV1 {
  if (!input.trustedUserId.trim()) throw new Error("financial_coverage_evidence_missing_user");
  if (!SHA.test(input.inventoryFingerprint)) throw new Error("financial_coverage_evidence_invalid_inventory_fingerprint");
  if (input.resolution.inventoryFingerprint !== input.inventoryFingerprint) throw new Error("financial_coverage_evidence_inventory_mismatch");
  const resolvedAt = time(input.resolvedAt, "financial_coverage_evidence_invalid_window");
  const validUntil = time(input.validUntil, "financial_coverage_evidence_invalid_window");
  if (validUntil <= resolvedAt || input.resolution.coverageValidUntil !== new Date(validUntil).toISOString()) throw new Error("financial_coverage_evidence_invalid_window");
  const values = [input.resolution.expectedMaterialCount, input.resolution.connectedMaterialCount, input.resolution.missingMaterialCount, input.resolution.staleConnectedSourceCount, input.resolution.connectedSourceCount];
  if (!values.every(count) || input.resolution.connectedMaterialCount + input.resolution.missingMaterialCount !== input.resolution.expectedMaterialCount) throw new Error("financial_coverage_evidence_invalid_counts");
  if (input.resolution.criticalSourcesComplete && (input.resolution.missingMaterialCount !== 0 || input.resolution.reasonCodes.length !== 0)) throw new Error("financial_coverage_evidence_false_complete");
  if (input.resolution.criticalSourcesFresh !== (input.resolution.staleConnectedSourceCount === 0) || (input.resolution.criticalSourcesFresh && input.resolution.freshnessReasonCodes.length !== 0)) throw new Error("financial_coverage_evidence_freshness_mismatch");

  const material = sourceCoverageEvidenceMaterial({
    version: "source-coverage-evidence-v1",
    userId: input.trustedUserId,
    inventoryFingerprint: input.inventoryFingerprint,
    resolvedAt: new Date(resolvedAt).toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    criticalSourcesComplete: input.resolution.criticalSourcesComplete,
    criticalSourcesFresh: input.resolution.criticalSourcesFresh,
    expectedMaterialCount: input.resolution.expectedMaterialCount,
    connectedMaterialCount: input.resolution.connectedMaterialCount,
    missingMaterialCount: input.resolution.missingMaterialCount,
    staleConnectedSourceCount: input.resolution.staleConnectedSourceCount,
    connectedSourceCount: input.resolution.connectedSourceCount,
    reasonCodes: input.resolution.reasonCodes,
    freshnessReasonCodes: input.resolution.freshnessReasonCodes,
  });
  return { ...material, fingerprint: sha256FinancialFingerprint(material) };
}

export function sourceCoverageResolutionFromEvidence(input: {
  trustedUserId: string;
  evidence: SourceCoverageEvidenceV1;
  expectedInventoryFingerprint: string;
  nowIso: string;
}): TrustedSourceCoverageResolution | null {
  const evidence = input.evidence;
  if (evidence.userId !== input.trustedUserId || evidence.inventoryFingerprint !== input.expectedInventoryFingerprint) throw new Error("financial_coverage_evidence_owner_or_inventory_mismatch");
  if (sha256FinancialFingerprint(sourceCoverageEvidenceMaterial(evidence)) !== evidence.fingerprint) throw new Error("financial_coverage_evidence_fingerprint_mismatch");
  const now = time(input.nowIso, "financial_coverage_evidence_invalid_now");
  if (time(evidence.validUntil, "financial_coverage_evidence_invalid_window") <= now) return null;
  return {
    criticalSourcesComplete: evidence.criticalSourcesComplete,
    criticalSourcesFresh: evidence.criticalSourcesFresh,
    expectedMaterialCount: evidence.expectedMaterialCount,
    connectedMaterialCount: evidence.connectedMaterialCount,
    missingMaterialCount: evidence.missingMaterialCount,
    staleConnectedSourceCount: evidence.staleConnectedSourceCount,
    connectedSourceCount: evidence.connectedSourceCount,
    reasonCodes: evidence.reasonCodes,
    freshnessReasonCodes: evidence.freshnessReasonCodes,
    inventoryFingerprint: evidence.inventoryFingerprint,
    coverageValidUntil: evidence.validUntil,
  };
}
