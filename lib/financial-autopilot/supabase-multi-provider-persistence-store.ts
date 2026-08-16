import type {
  MultiProviderPersistenceResult,
  MultiProviderPersistenceStore,
} from "./multi-provider-persistence-store";
import type { MultiProviderScopedPersistencePlan } from "./multi-provider-scoped-persistence";

export const MULTI_PROVIDER_PERSISTENCE_RPC_V1_3 =
  "eos_financial_persist_multi_provider_v1_3" as const;

export interface MultiProviderPersistenceRpcClient {
  rpc(
    functionName: typeof MULTI_PROVIDER_PERSISTENCE_RPC_V1_3,
    args: {
      p_usuario_id: string;
      p_batch: MultiProviderScopedPersistencePlan;
    },
  ): Promise<{
    data: unknown;
    error: { code?: string | null } | null;
  }>;
}

function nonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function parseMultiProviderPersistenceRpcResponse(
  value: unknown,
): MultiProviderPersistenceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("financial_multi_provider_persistence_invalid_rpc_response");
  }

  const row = value as Record<string, unknown>;
  if (
    typeof row.replayed !== "boolean" ||
    typeof row.planFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.planFingerprint) ||
    (row.globalContextRevision !== null &&
      (typeof row.globalContextRevision !== "string" ||
        !/^ctx:[a-f0-9]{64}$/.test(row.globalContextRevision))) ||
    !nonNegativeInteger(row.providerScopesTouched) ||
    !nonNegativeInteger(row.ledgerRowsTouched) ||
    !nonNegativeInteger(row.ingestionRowsTouched)
  ) {
    throw new Error("financial_multi_provider_persistence_invalid_rpc_response");
  }

  return {
    replayed: row.replayed,
    planFingerprint: row.planFingerprint,
    globalContextRevision: row.globalContextRevision as string | null,
    providerScopesTouched: row.providerScopesTouched,
    ledgerRowsTouched: row.ledgerRowsTouched,
    ingestionRowsTouched: row.ingestionRowsTouched,
  };
}

/**
 * Server-only adapter contract for the future atomic multi-provider RPC.
 *
 * It is intentionally not wired to production. The injected RPC client must be
 * a trusted server/service boundary, never a browser Supabase client. The RPC
 * itself remains design-only until validated against a non-production database.
 */
export class SupabaseMultiProviderPersistenceStore
  implements MultiProviderPersistenceStore
{
  constructor(
    private readonly rpcClient: MultiProviderPersistenceRpcClient,
    private readonly trustedUserId: string,
  ) {
    if (!trustedUserId) {
      throw new Error("financial_multi_provider_persistence_missing_trusted_user");
    }
  }

  async persist(
    plan: MultiProviderScopedPersistencePlan,
  ): Promise<MultiProviderPersistenceResult> {
    if (
      plan.userId !== this.trustedUserId ||
      plan.manifest.trustedUserId !== this.trustedUserId ||
      (plan.globalContextPlan &&
        plan.globalContextPlan.userId !== this.trustedUserId)
    ) {
      throw new Error("financial_multi_provider_persistence_user_mismatch");
    }

    const { data, error } = await this.rpcClient.rpc(
      MULTI_PROVIDER_PERSISTENCE_RPC_V1_3,
      {
        p_usuario_id: this.trustedUserId,
        p_batch: plan,
      },
    );

    if (error) {
      const code = error.code ? `:${error.code}` : "";
      throw new Error(`financial_multi_provider_persistence_rpc_failed${code}`);
    }

    const parsed = parseMultiProviderPersistenceRpcResponse(data);
    if (parsed.planFingerprint !== plan.planFingerprint) {
      throw new Error("financial_multi_provider_persistence_plan_fingerprint_mismatch");
    }
    if (
      parsed.globalContextRevision !==
      (plan.globalContextPlan?.revision ?? null)
    ) {
      throw new Error("financial_multi_provider_persistence_context_revision_mismatch");
    }

    return parsed;
  }
}
