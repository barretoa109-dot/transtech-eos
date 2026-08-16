import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { FinancialObligation } from "./types";

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function canonicalIso(value: string, code: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(code);
  return new Date(time).toISOString();
}

/**
 * Stable per-obligation identity used by Financial Context explanation refs and
 * by the persisted read adapter. It commits to every material field that can
 * change protection or forecast semantics while leaving the DB source_key free
 * to remain a stable upsert key.
 */
export function protectedObligationContextId(obligation: FinancialObligation) {
  return sha256FinancialFingerprint({
    contract: "protected-obligation-context-v1",
    sourceKey: normalizeText(obligation.id),
    type: normalizeText(obligation.type),
    amountMinor: obligation.amountMinor,
    currency: obligation.currency,
    dueAt: canonicalIso(
      obligation.dueAt,
      "financial_state_invalid_obligation_due_at",
    ),
    priority: obligation.priority,
    mustProtect: obligation.mustProtect,
    confidence: obligation.confidence,
    source: normalizeText(obligation.source),
  });
}

export function protectedObligationExplanationRef(
  obligation: FinancialObligation,
) {
  return `obligation:${protectedObligationContextId(obligation)}`;
}
