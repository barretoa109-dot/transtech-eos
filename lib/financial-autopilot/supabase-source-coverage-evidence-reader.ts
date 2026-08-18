import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSourceCoverageEvidenceV1,
  sourceCoverageResolutionFromEvidence,
  type SourceCoverageEvidenceV1,
} from "./source-coverage-evidence";
import type { TrustedSourceCoverageResolution } from "./source-coverage";

const SHA = /^[0-9a-f]{64}$/;
const COLUMNS = "usuario_id,inventory_fingerprint,evidence,evidence_fingerprint,valid_until";

function parseEvidence(value: unknown, userId: string, inventoryFingerprint: string): SourceCoverageEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("financial_coverage_evidence_invalid_payload");
  const row = value as Record<string, unknown>;
  const evidence = row.evidence as SourceCoverageEvidenceV1;
  if (row.usuario_id !== userId || row.inventory_fingerprint !== inventoryFingerprint || !SHA.test(String(row.evidence_fingerprint ?? "")) || !evidence || typeof evidence !== "object") throw new Error("financial_coverage_evidence_owner_or_inventory_mismatch");
  const rebuilt = buildSourceCoverageEvidenceV1({
    trustedUserId: userId,
    inventoryFingerprint,
    resolvedAt: String(evidence.resolvedAt ?? ""),
    validUntil: String(evidence.validUntil ?? ""),
    resolution: {
      criticalSourcesComplete: evidence.criticalSourcesComplete,
      criticalSourcesFresh: evidence.criticalSourcesFresh,
      expectedMaterialCount: evidence.expectedMaterialCount,
      connectedMaterialCount: evidence.connectedMaterialCount,
      missingMaterialCount: evidence.missingMaterialCount,
      staleConnectedSourceCount: evidence.staleConnectedSourceCount,
      connectedSourceCount: evidence.connectedSourceCount,
      reasonCodes: evidence.reasonCodes,
      freshnessReasonCodes: evidence.freshnessReasonCodes,
      inventoryFingerprint,
      coverageValidUntil: String(evidence.validUntil ?? ""),
    },
  });
  if (rebuilt.fingerprint !== row.evidence_fingerprint || rebuilt.fingerprint !== evidence.fingerprint) throw new Error("financial_coverage_evidence_fingerprint_mismatch");
  return rebuilt;
}

export class SupabaseSourceCoverageEvidenceReader {
  constructor(private readonly client: Pick<SupabaseClient, "from">) {}
  async getCurrent(input: { userId: string; inventoryFingerprint: string; nowIso: string }): Promise<TrustedSourceCoverageResolution | null> {
    if (!SHA.test(input.inventoryFingerprint)) throw new Error("financial_coverage_evidence_invalid_inventory_fingerprint");
    const { data, error } = await this.client.from("eos_financial_source_coverage_evidence_v1").select(COLUMNS).eq("usuario_id", input.userId).eq("inventory_fingerprint", input.inventoryFingerprint).gt("valid_until", input.nowIso).order("valid_until", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`financial_coverage_evidence_read_failed:${error.code || "unknown"}`);
    if (!data) return null;
    return sourceCoverageResolutionFromEvidence({ trustedUserId: input.userId, evidence: parseEvidence(data, input.userId, input.inventoryFingerprint), expectedInventoryFingerprint: input.inventoryFingerprint, nowIso: input.nowIso });
  }
}
