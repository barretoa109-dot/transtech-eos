import type { SupabaseClient } from "@supabase/supabase-js";
import { financialContextIntegrityMatches } from "./financial-context-integrity";
import { parsePersistedFirstForecastRisk } from "./first-forecast-risk-persistence";
import type {
  FinancialStateReader,
  PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import { protectedObligationContextId } from "./protected-obligations-fingerprint";
import { SupabaseFinancialStateReader } from "./supabase-financial-state-reader";
import type { FinancialObligation } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readError(prefix: string, error: { code?: string | null } | null) {
  if (!error) return null;
  return new Error(`${prefix}:${error.code || "unknown"}`);
}

/**
 * v1.1 reader extension. The base reader retains the strict normalized context
 * and obligation reads; this adapter adds one owner-scoped projection for the
 * persisted first forecast risk. No raw Ledger/ingestion evidence is queried.
 */
export class SupabaseFinancialStateReaderV1_1 implements FinancialStateReader {
  private readonly baseReader: FinancialStateReader;

  constructor(
    private readonly client: Pick<SupabaseClient, "from">,
    private readonly trustedUserId: string,
    baseReader?: FinancialStateReader,
  ) {
    if (!UUID.test(trustedUserId)) throw new Error("financial_state_invalid_trusted_user");
    this.baseReader =
      baseReader ?? new SupabaseFinancialStateReader(client, trustedUserId);
  }

  async getLatestContext(userId: string): Promise<PersistedFinancialContextRecord | null> {
    if (userId !== this.trustedUserId) throw new Error("financial_state_user_mismatch");

    const base = await this.baseReader.getLatestContext(userId);
    if (!base) return null;

    // v1.1 contexts carry a compact commitment over every aggregate field used
    // to assert safety. Any DB/context drift must fail before a state can be
    // projected as current or SAFE.
    if (!financialContextIntegrityMatches(base, base.explanationRefs)) {
      throw new Error("financial_state_context_integrity_mismatch");
    }

    const { data, error } = await this.client
      .from("eos_financial_contexts_v1")
      .select("revision,first_forecast_risk")
      .eq("usuario_id", this.trustedUserId)
      .eq("revision", base.revision)
      .maybeSingle();

    const failure = readError("financial_state_forecast_risk_read_failed", error);
    if (failure) throw failure;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("financial_state_forecast_risk_missing");
    }

    const row = data as Record<string, unknown>;
    if (row.revision !== base.revision) {
      throw new Error("financial_state_forecast_risk_revision_mismatch");
    }

    return {
      ...base,
      firstForecastRisk: parsePersistedFirstForecastRisk(row.first_forecast_risk),
    };
  }

  async getOpenObligations(input: {
    userId: string;
    currency: string;
    horizonUntil: string;
  }): Promise<FinancialObligation[]> {
    if (input.userId !== this.trustedUserId) throw new Error("financial_state_user_mismatch");
    const obligations = await this.baseReader.getOpenObligations(input);

    // Context explanation refs commit to material obligation identities rather
    // than only stable source keys. Re-derive the exact same identity at read
    // time so due date/type/priority/confidence/source drift fails closed even
    // when the source key and amount remain unchanged.
    return obligations.map((obligation) => ({
      ...obligation,
      id: protectedObligationContextId(obligation),
    }));
  }
}
