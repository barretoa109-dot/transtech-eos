import type { SupabaseClient } from "@supabase/supabase-js";
import {
  criticalObligationsCompletenessMatches,
  parsePersistedCriticalObligationsComplete,
} from "./critical-obligations-persistence";
import type {
  FinancialStateReader,
  PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import { SupabaseFinancialStateReaderV1_1 } from "./supabase-financial-state-reader-v1-1";
import type { FinancialObligation } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readError(prefix: string, error: { code?: string | null } | null) {
  if (!error) return null;
  return new Error(`${prefix}:${error.code || "unknown"}`);
}

/**
 * v1.2 reader extension. It preserves the v1.1 aggregate/risk/material-
 * obligation checks and adds one explicit owner+revision scoped hard safety
 * signal: criticalObligationsComplete.
 */
export class SupabaseFinancialStateReaderV1_2 implements FinancialStateReader {
  private readonly baseReader: FinancialStateReader;

  constructor(
    private readonly client: Pick<SupabaseClient, "from">,
    private readonly trustedUserId: string,
    baseReader?: FinancialStateReader,
  ) {
    if (!UUID.test(trustedUserId)) throw new Error("financial_state_invalid_trusted_user");
    this.baseReader =
      baseReader ?? new SupabaseFinancialStateReaderV1_1(client, trustedUserId);
  }

  async getLatestContext(userId: string): Promise<PersistedFinancialContextRecord | null> {
    if (userId !== this.trustedUserId) throw new Error("financial_state_user_mismatch");

    const base = await this.baseReader.getLatestContext(userId);
    if (!base) return null;

    const { data, error } = await this.client
      .from("eos_financial_contexts_v1")
      .select("revision,critical_obligations_complete")
      .eq("usuario_id", this.trustedUserId)
      .eq("revision", base.revision)
      .maybeSingle();

    const failure = readError("financial_state_critical_obligations_read_failed", error);
    if (failure) throw failure;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("financial_state_critical_obligations_missing");
    }

    const row = data as Record<string, unknown>;
    if (row.revision !== base.revision) {
      throw new Error("financial_state_critical_obligations_revision_mismatch");
    }

    const criticalObligationsComplete = parsePersistedCriticalObligationsComplete(
      row.critical_obligations_complete,
    );
    if (
      !criticalObligationsCompletenessMatches({
        criticalObligationsComplete,
        explanationRefs: base.explanationRefs,
      })
    ) {
      throw new Error("financial_state_critical_obligations_integrity_mismatch");
    }

    // In v1.2 an explicit false is a hard safety gate. Do not reinterpret a
    // confidence score as completeness and do not let an inconsistent stored
    // SAFE/ATTENTION/ACTION_REQUIRED status survive this read boundary.
    if (!criticalObligationsComplete) {
      return {
        ...base,
        status: "DEGRADED",
        sourcesFresh: false,
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
