import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { FinancialContextConfidence, FinancialStatus } from "./types";

export const FINANCIAL_CONTEXT_INTEGRITY_PREFIX = "context-integrity:";

export interface FinancialContextIntegrityInput {
  currency: string;
  status: FinancialStatus;
  horizonUntil: string;
  liquidityUsableMinor: number;
  protectedCommitmentsMinor: number;
  essentialSpendExpectedMinor: number;
  protectedReserveMinor: number;
  criticalProvisionsMinor: number;
  confirmedIncomeMinor: number;
  uncertaintyBufferMinor: number;
  availableRealSafeMinor: number;
  minimumProjectedCashMinor: number;
  minimumProjectedCashAt: string | null;
  confidence: FinancialContextConfidence;
  sourcesFresh: boolean;
  generatedAt: string;
  validUntil: string | null;
}

function canonicalIso(value: string, code: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(code);
  return new Date(time).toISOString();
}

function canonicalNullableIso(value: string | null, code: string) {
  return value === null ? null : canonicalIso(value, code);
}

/**
 * Compact integrity commitment for the aggregate financial context fields that
 * the user-facing state relies on. It deliberately excludes explanation refs,
 * revision and source fingerprint so it can be stored inside explanation refs
 * without a recursive hash dependency.
 */
export function financialContextIntegrityHash(
  input: FinancialContextIntegrityInput,
) {
  return sha256FinancialFingerprint({
    contract: "financial-context-integrity-v1",
    currency: input.currency,
    status: input.status,
    horizonUntil: canonicalIso(
      input.horizonUntil,
      "financial_context_integrity_invalid_horizon",
    ),
    liquidityUsableMinor: input.liquidityUsableMinor,
    protectedCommitmentsMinor: input.protectedCommitmentsMinor,
    essentialSpendExpectedMinor: input.essentialSpendExpectedMinor,
    protectedReserveMinor: input.protectedReserveMinor,
    criticalProvisionsMinor: input.criticalProvisionsMinor,
    confirmedIncomeMinor: input.confirmedIncomeMinor,
    uncertaintyBufferMinor: input.uncertaintyBufferMinor,
    availableRealSafeMinor: input.availableRealSafeMinor,
    minimumProjectedCashMinor: input.minimumProjectedCashMinor,
    minimumProjectedCashAt: canonicalNullableIso(
      input.minimumProjectedCashAt,
      "financial_context_integrity_invalid_minimum_cash_at",
    ),
    confidence: input.confidence,
    sourcesFresh: input.sourcesFresh,
    generatedAt: canonicalIso(
      input.generatedAt,
      "financial_context_integrity_invalid_generated_at",
    ),
    validUntil: canonicalNullableIso(
      input.validUntil,
      "financial_context_integrity_invalid_valid_until",
    ),
  });
}

export function financialContextIntegrityRef(
  input: FinancialContextIntegrityInput,
) {
  return `${FINANCIAL_CONTEXT_INTEGRITY_PREFIX}${financialContextIntegrityHash(input)}`;
}

export function financialContextIntegrityMatches(
  input: FinancialContextIntegrityInput,
  explanationRefs: string[],
) {
  const integrityRefs = explanationRefs.filter((ref) =>
    ref.startsWith(FINANCIAL_CONTEXT_INTEGRITY_PREFIX),
  );
  return (
    integrityRefs.length === 1 &&
    integrityRefs[0] === financialContextIntegrityRef(input)
  );
}
