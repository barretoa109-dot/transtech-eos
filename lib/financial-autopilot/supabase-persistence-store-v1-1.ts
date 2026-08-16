import type { FinancialPersistencePlanV1_1 } from "./first-forecast-risk-persistence";
import {
  parseFinancialPersistenceRpcResponse,
  type FinancialPersistenceRpcResponse,
} from "./supabase-persistence-store";

export interface FinancialPersistenceRpcClientV1_1 {
  rpc(
    functionName: "eos_financial_persist_snapshot_v1_1",
    args: {
      p_usuario_id: string;
      p_batch: FinancialPersistencePlanV1_1;
    },
  ): Promise<{
    data: unknown;
    error: { message?: string; code?: string; details?: string; hint?: string } | null;
  }>;
}

/**
 * Server-only adapter for the v1.1 context extension. It deliberately targets
 * the wrapper RPC that atomically persists the base snapshot plus the compact
 * first forecast risk.
 */
export class SupabaseFinancialPersistenceStoreV1_1 {
  constructor(
    private readonly rpcClient: FinancialPersistenceRpcClientV1_1,
    private readonly trustedUserId: string,
  ) {
    if (!trustedUserId) throw new Error("financial_persistence_missing_trusted_user");
  }

  async persist(plan: FinancialPersistencePlanV1_1): Promise<FinancialPersistenceRpcResponse> {
    if (
      plan.userId !== this.trustedUserId ||
      plan.contextInsert.userId !== this.trustedUserId
    ) {
      throw new Error("financial_persistence_user_mismatch");
    }

    const { data, error } = await this.rpcClient.rpc(
      "eos_financial_persist_snapshot_v1_1",
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
