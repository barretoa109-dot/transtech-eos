import type { FinancialConstitutionV1 } from "./financial-constitution";
import {
  financialConstitutionPolicyMaterial,
  isFinancialConstitutionConfirmed,
} from "./financial-constitution";
import { sha256FinancialFingerprint } from "./persistence-fingerprint";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY_FINGERPRINT = /^policy:[0-9a-f]{64}$/;

export interface FinancialConstitutionRpcClient {
  rpc(
    functionName: "eos_financial_persist_constitution_v1",
    args: {
      p_usuario_id: string;
      p_policy: ReturnType<typeof financialConstitutionPolicyMaterial>;
      p_policy_fingerprint: string;
      p_confirmed_at: string;
      p_expected_current_version: number;
    },
  ): Promise<{
    data: unknown;
    error: { code?: string | null; message?: string | null } | null;
  }>;
}

export interface FinancialConstitutionPersistenceReceipt {
  constitutionId: string;
  version: number;
  policyFingerprint: string;
  replayed: boolean;
}

function parseReceipt(value: unknown): FinancialConstitutionPersistenceReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("financial_constitution_rpc_invalid_response");
  }
  const row = value as Record<string, unknown>;
  if (
    !UUID.test(String(row.constitutionId ?? "")) ||
    !Number.isSafeInteger(row.version) ||
    (row.version as number) <= 0 ||
    !POLICY_FINGERPRINT.test(String(row.policyFingerprint ?? "")) ||
    typeof row.replayed !== "boolean"
  ) {
    throw new Error("financial_constitution_rpc_invalid_response");
  }
  return {
    constitutionId: String(row.constitutionId),
    version: row.version as number,
    policyFingerprint: String(row.policyFingerprint),
    replayed: row.replayed,
  };
}

/** Server-only, owner-bound Constitution persistence adapter. */
export class SupabaseFinancialConstitutionStore {
  constructor(
    private readonly client: FinancialConstitutionRpcClient,
    private readonly trustedUserId: string,
  ) {
    if (!UUID.test(trustedUserId)) {
      throw new Error("financial_constitution_invalid_trusted_user");
    }
  }

  async persist(input: {
    constitution: FinancialConstitutionV1;
    expectedCurrentVersion: number;
  }): Promise<FinancialConstitutionPersistenceReceipt> {
    if (!Number.isSafeInteger(input.expectedCurrentVersion) || input.expectedCurrentVersion < 0) {
      throw new Error("financial_constitution_invalid_expected_version");
    }
    if (!isFinancialConstitutionConfirmed(input.constitution)) {
      throw new Error("financial_constitution_confirmation_required");
    }
    if (input.constitution.executionAuthorityMinor !== 0) {
      throw new Error("financial_constitution_pilot_execution_must_be_zero");
    }

    const policy = financialConstitutionPolicyMaterial(input.constitution);
    const expectedFingerprint = `policy:${sha256FinancialFingerprint(policy)}`;
    if (expectedFingerprint !== input.constitution.policyFingerprint) {
      throw new Error("financial_constitution_fingerprint_mismatch");
    }

    const { data, error } = await this.client.rpc(
      "eos_financial_persist_constitution_v1",
      {
        p_usuario_id: this.trustedUserId,
        p_policy: policy,
        p_policy_fingerprint: input.constitution.policyFingerprint,
        p_confirmed_at: input.constitution.confirmedAt!,
        p_expected_current_version: input.expectedCurrentVersion,
      },
    );
    if (error) {
      throw new Error(`financial_constitution_rpc_failed:${error.code || "unknown"}`);
    }

    const receipt = parseReceipt(data);
    if (receipt.policyFingerprint !== input.constitution.policyFingerprint) {
      throw new Error("financial_constitution_rpc_fingerprint_mismatch");
    }
    if (!receipt.replayed && receipt.version !== input.expectedCurrentVersion + 1) {
      throw new Error("financial_constitution_rpc_version_mismatch");
    }
    return receipt;
  }
}
