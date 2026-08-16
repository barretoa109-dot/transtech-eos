import type { FinancialPersistencePlanV1_2 } from "./critical-obligations-persistence";
import {
  parseFinancialPersistenceRpcResponse,
  type FinancialPersistenceRpcResponse,
} from "./supabase-persistence-store";

export interface FinancialPersistenceRpcClientV1_2 {
  rpc(
    functionName: "eos_financial_persist_snapshot_v1_2",
    args: {
      p_usuario_id: string;
      p_batch: FinancialPersistencePlanV1_2;
    },
  ): Promise<{
    data: unknown;
    error: { message?: string; code?: string; details?: string; hint?: string } | null;
  }>;
}

/**
 * Server-only adapter for the v1.2 completeness extension. The corresponding
 * SQL remains a design-only non-production promotion candidate.
 */
export class SupabaseFinancialPersistenceStoreV1_2 {
  constructor(
    private readonly rpcClient: FinancialPersistenceRpcClientV1_2,
    private readonly trustedUserId: string,
  ) {
    if (!trustedUserId) throw new Error("financial_persistence_missing_trusted_user");
  }

  async persist(plan: FinancialPersistencePlanV1_2): Promise<FinancialPersistenceRpcResponse> {
    if (
      plan.userId !== this.trustedUserId ||
      plan.contextInsert.userId !== this.trustedUserId
    ) {
      throw new Error("financial_persistence_user_mismatch");
    }

    const { data, error } = await this.rpcClient.rpc(
      "eos_financial_persist_snapshot_v1_2",
      {
        p_usuario_id: this.trustedUserId,
        p_batch: plan,
      },
    );

    if (error) {
      const code = error.code ? `:${error.code}` : "";
      throw new Error(`financial_persistence_rpc_failed${code}`);
    }

    const parsed = parseFinancialPersistenceRpcResponse(data);
    if (parsed.contextRevision !== plan.contextInsert.revision) {
      throw new Error("financial_persistence_context_revision_mismatch");
    }

    return parsed;
  }
}
