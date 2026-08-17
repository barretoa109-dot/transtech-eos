import { sha256FinancialFingerprint } from "./persistence-fingerprint";

const CURRENCY = /^[A-Z]{3}$/;
const POLICY_VERSION = 1 as const;

export type FinancialAutonomyLevel = "OBSERVE" | "RECOMMEND" | "PREPARE";
export type FinancialDebtPolicy =
  | "PAY_CARD_FULL"
  | "PAY_MINIMUMS_FIRST"
  | "HIGHEST_RATE_FIRST"
  | "SMALLEST_BALANCE_FIRST";

export interface FinancialConstitutionV1 {
  version: "financial-constitution-v1";
  policyVersion: typeof POLICY_VERSION;
  currency: string;
  protectedLiquidityMinor: number;
  minimumSavingsRateBps: number;
  debtPolicy: FinancialDebtPolicy;
  primaryGoal: {
    id: string;
    label: string;
    priority: "HIGH" | "MEDIUM" | "LOW";
  };
  approvalThresholdMinor: number;
  autonomyLevel: FinancialAutonomyLevel;
  executionAuthorityMinor: 0;
  confirmedAt: string | null;
  policyFingerprint: `policy:${string}`;
}

export interface FinancialConstitutionV1Input {
  currency: string;
  protectedLiquidityMinor: number;
  minimumSavingsRateBps: number;
  debtPolicy: FinancialDebtPolicy;
  primaryGoal: FinancialConstitutionV1["primaryGoal"];
  approvalThresholdMinor: number;
  autonomyLevel: FinancialAutonomyLevel;
  executionAuthorityMinor?: number;
  confirmedAt?: string | null;
}

export type FinancialConstitutionPolicyV1 = Omit<
  FinancialConstitutionV1,
  "policyFingerprint"
>;

function integerInRange(value: number, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function boundedText(value: string, field: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`financial_constitution_invalid_${field}`);
  }
  return normalized;
}

function confirmedIso(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  if (value.length > 64 || !Number.isFinite(new Date(value).getTime())) {
    throw new Error("financial_constitution_invalid_confirmed_at");
  }
  return value;
}

/**
 * Builds the exact user-confirmed policy payload stored in
 * eos_financial_constitutions_v1.policy. In the post-RC1 read-only pilot the
 * monetary execution authority is deliberately fixed to zero.
 */
export function buildFinancialConstitutionV1(
  input: FinancialConstitutionV1Input,
): FinancialConstitutionV1 {
  if (!CURRENCY.test(input.currency)) {
    throw new Error("financial_constitution_invalid_currency");
  }
  if (!integerInRange(input.protectedLiquidityMinor, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error("financial_constitution_invalid_liquidity_floor");
  }
  if (!integerInRange(input.minimumSavingsRateBps, 0, 10_000)) {
    throw new Error("financial_constitution_invalid_savings_rate");
  }
  if (!integerInRange(input.approvalThresholdMinor, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error("financial_constitution_invalid_approval_threshold");
  }
  if ((input.executionAuthorityMinor ?? 0) !== 0) {
    throw new Error("financial_constitution_pilot_execution_must_be_zero");
  }

  const policy = {
    version: "financial-constitution-v1" as const,
    policyVersion: POLICY_VERSION,
    currency: input.currency,
    protectedLiquidityMinor: input.protectedLiquidityMinor,
    minimumSavingsRateBps: input.minimumSavingsRateBps,
    debtPolicy: input.debtPolicy,
    primaryGoal: {
      id: boundedText(input.primaryGoal.id, "goal_id", 128),
      label: boundedText(input.primaryGoal.label, "goal_label", 128),
      priority: input.primaryGoal.priority,
    },
    approvalThresholdMinor: input.approvalThresholdMinor,
    autonomyLevel: input.autonomyLevel,
    executionAuthorityMinor: 0 as const,
    confirmedAt: confirmedIso(input.confirmedAt),
  };

  return {
    ...policy,
    policyFingerprint: `policy:${sha256FinancialFingerprint(policy)}`,
  };
}

export function financialConstitutionPolicyMaterial(
  constitution: FinancialConstitutionV1,
): FinancialConstitutionPolicyV1 {
  return {
    version: constitution.version,
    policyVersion: constitution.policyVersion,
    currency: constitution.currency,
    protectedLiquidityMinor: constitution.protectedLiquidityMinor,
    minimumSavingsRateBps: constitution.minimumSavingsRateBps,
    debtPolicy: constitution.debtPolicy,
    primaryGoal: constitution.primaryGoal,
    approvalThresholdMinor: constitution.approvalThresholdMinor,
    autonomyLevel: constitution.autonomyLevel,
    executionAuthorityMinor: constitution.executionAuthorityMinor,
    confirmedAt: constitution.confirmedAt,
  };
}

export function isFinancialConstitutionConfirmed(
  constitution: FinancialConstitutionV1 | null,
) {
  return constitution?.confirmedAt !== null && constitution !== null;
}
