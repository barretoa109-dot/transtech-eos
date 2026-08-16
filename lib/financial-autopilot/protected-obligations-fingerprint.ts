import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { FinancialObligation } from "./types";

export const PROTECTED_OBLIGATIONS_FINGERPRINT_PREFIX = "protected-obligations:";

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function canonicalIso(value: string, code: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(code);
  return new Date(time).toISOString();
}

/**
 * Commits the material fields of the protected obligation set into a compact,
 * deterministic SHA-256 identity. This catches due date, type, priority,
 * confidence, protection and source drift even when ids and total amounts stay
 * unchanged.
 */
export function protectedObligationsFingerprint(
  obligations: FinancialObligation[],
) {
  const material = obligations
    .filter((obligation) => obligation.mustProtect && obligation.confidence >= 0.75)
    .map((obligation) => ({
      id: normalizeText(obligation.id),
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
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return sha256FinancialFingerprint({
    contract: "protected-obligations-v1",
    obligations: material,
  });
}

export function protectedObligationsFingerprintRef(
  obligations: FinancialObligation[],
) {
  return `${PROTECTED_OBLIGATIONS_FINGERPRINT_PREFIX}${protectedObligationsFingerprint(obligations)}`;
}
