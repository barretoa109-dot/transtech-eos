import type {
  FinancialPersistencePlan,
  FinancialPersistenceStore,
} from "./persistence";

export interface FinancialPersistenceRpcResponse {
  replayed: boolean;
  contextRevision: string;
  ledgerRowsTouched: number;
  ingestionRowsTouched: number;
  reconciliationRowsTouched: number;
}

export interface FinancialPersistenceRpcClient {
  rpc(
    functionName: "eos_financial_persist_snapshot_v1",
    args: {
      p_usuario_id: string;
      p_batch: FinancialPersistencePlan;
    },
  ): Promise<{
    data: unknown;
    error: { message?: string; code?: string; details?: string; hint?: string } | null;
  }>;
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number.isFinite(value) && (value as number) >= 0;
}

export function parseFinancialPersistenceRpcResponse(
  value: unknown,
): FinancialPersistenceRpcResponse {
  if (!value || typeof value !== "object") {
    throw new Error("financial_persistence_invalid_rpc_response");
  }

  const row = value as Record<string, unknown>;
  if (
    typeof row.replayed !== "boolean" ||
    typeof row.contextRevision !== "string" ||
    row.contextRevision.length === 0 ||
    !finiteNonNegativeInteger(row.ledgerRowsTouched) ||
    !finiteNonNegativeInteger(row.ingestionRowsTouched) ||
    !finiteNonNegativeInteger(row.reconciliationRowsTouched)
  ) {
    throw new Error("financial_persistence_invalid_rpc_response");
  }

  return {
    replayed: row.replayed,
    contextRevision: row.contextRevision,
    ledgerRowsTouched: row.ledgerRowsTouched,
    ingestionRowsTouched: row.ingestionRowsTouched,
    reconciliationRowsTouched: row.reconciliationRowsTouched,
  };
}

/**
 * Server-only persistence adapter contract.
 *
 * The caller must inject a server/service Supabase client and a user id derived
 * from the authenticated server session. The adapter deliberately refuses to
 * persist a plan whose embedded user differs from that trusted boundary.
 *
 * This class is not wired to production until the post-RC1 schema/RPC is
 * validated and applied in a non-production Supabase environment first.
 */
export class SupabaseFinancialPersistenceStore implements FinancialPersistenceStore {
  constructor(
    private readonly rpcClient: FinancialPersistenceRpcClient,
    private readonly trustedUserId: string,
  ) {
    if (!trustedUserId) throw new Error("financial_persistence_missing_trusted_user");
  }

  async persist(plan: FinancialPersistencePlan): Promise<FinancialPersistenceRpcResponse> {
    if (plan.userId !== this.trustedUserId) {
      throw new Error("financial_persistence_user_mismatch");
    }

    const { data, error } = await this.rpcClient.rpc(
      "eos_financial_persist_snapshot_v1",
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
