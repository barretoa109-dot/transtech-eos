import type { SupabaseClient } from "@supabase/supabase-js";
import {
  criticalSourcesCompletenessMatches,
  parsePersistedCriticalSourcesComplete,
} from "./critical-sources-persistence";
import type {
  FinancialStateReader,
  PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import { SupabaseFinancialStateReaderV1_2 } from "./supabase-financial-state-reader-v1-2";
import type { FinancialObligation } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readError(prefix: string, error: { code?: string | null } | null) {
  if (!error) return null;
  return new Error(`${prefix}:${error.code || "unknown"}`);
}

/**
 * v1.3 reader extension. Freshness answers whether known critical sources are
 * current. Coverage answers whether EOS knows the material source set is
 * complete enough to claim safety. Those are intentionally separate gates.
 */
export class SupabaseFinancialStateReaderV1_3 implements FinancialStateReader {
  private readonly baseReader: FinancialStateReader;

  constructor(
    private readonly client: Pick<SupabaseClient, "from">,
    private readonly trustedUserId: string,
    baseReader?: FinancialStateReader,
  ) {
    if (!UUID.test(trustedUserId)) throw new Error("financial_state_invalid_trusted_user");
    this.baseReader =
      baseReader ?? new SupabaseFinancialStateReaderV1_2(client, trustedUserId);
  }

  async getLatestContext(userId: string): Promise<PersistedFinancialContextRecord | null> {
    if (userId !== this.trustedUserId) throw new Error("financial_state_user_mismatch");

    const base = await this.baseReader.getLatestContext(userId);
    if (!base) return null;

    const { data, error } = await this.client
      .from("eos_financial_contexts_v1")
      .select("revision,critical_sources_complete")
      .eq("usuario_id", this.trustedUserId)
      .eq("revision", base.revision)
      .maybeSingle();

    const failure = readError("financial_state_critical_sources_read_failed", error);
    if (failure) throw failure;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("financial_state_critical_sources_missing");
    }

    const row = data as Record<string, unknown>;
    if (row.revision !== base.revision) {
      throw new Error("financial_state_critical_sources_revision_mismatch");
    }

    const criticalSourcesComplete = parsePersistedCriticalSourcesComplete(
      row.critical_sources_complete,
    );
    if (
      !criticalSourcesCompletenessMatches({
        criticalSourcesComplete,
        explanationRefs: base.explanationRefs,
      })
    ) {
      throw new Error("financial_state_critical_sources_integrity_mismatch");
    }

    if (!criticalSourcesComplete) {
      return {
        ...base,
        status: "DEGRADED",
      };
    }

    return base;
  }

  async getOpenObligations(input: {
    userId: string;
    currency: string;
    horizonUntil: string;
  }): Promise<FinancialObligation[]> {
    if (input.userId !== this.trustedUserId) throw new Error("financial_state_user_mismatch");
    return this.baseReader.getOpenObligations(input);
  }
}
