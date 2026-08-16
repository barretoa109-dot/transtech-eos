import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FinancialStateReader,
  PersistedFinancialContextRecord,
} from "./financial-state-resolver";
import type {
  FinancialContextConfidence,
  FinancialObligation,
  FinancialStatus,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTEXT_REVISION = /^ctx:[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const FINANCIAL_STATUSES = new Set<FinancialStatus>([
  "SAFE",
  "ATTENTION",
  "ACTION_REQUIRED",
  "DEGRADED",
]);

const CONTEXT_COLUMNS = [
  "usuario_id",
  "revision",
  "currency",
  "status",
  "horizon_until",
  "liquidity_usable_minor",
  "protected_commitments_minor",
  "protected_reserve_minor",
  "available_real_safe_minor",
  "minimum_projected_cash_minor",
  "minimum_projected_cash_at",
  "confidence",
  "explanation_refs",
  "sources_fresh",
  "generated_at",
  "valid_until",
].join(",");

const OBLIGATION_COLUMNS = [
  "source_key",
  "usuario_id",
  "obligation_type",
  "amount_minor",
  "currency",
  "due_at",
  "priority",
  "must_protect",
  "confidence",
  "source",
].join(",");

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, code: string, maxLength = 512) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(code);
  }
  return value;
}

function uuid(value: unknown, code: string) {
  const parsed = stringValue(value, code, 64);
  if (!UUID.test(parsed)) throw new Error(code);
  return parsed;
}

function currency(value: unknown, code: string) {
  const parsed = stringValue(value, code, 3);
  if (!CURRENCY.test(parsed)) throw new Error(code);
  return parsed;
}

function iso(value: unknown, code: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  const parsed = stringValue(value, code, 64);
  if (!Number.isFinite(new Date(parsed).getTime())) throw new Error(code);
  return parsed;
}

function safeInteger(value: unknown, code: string, allowNegative = false) {
  if (!Number.isSafeInteger(value)) throw new Error(code);
  const parsed = value as number;
  if (!allowNegative && parsed < 0) throw new Error(code);
  return parsed;
}

function confidenceNumber(value: unknown, code: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(code);
  }
  return value;
}

function parseConfidence(value: unknown): FinancialContextConfidence {
  const row = object(value, "financial_state_invalid_confidence");
  return {
    sourceFreshness: confidenceNumber(
      row.sourceFreshness,
      "financial_state_invalid_confidence",
    ),
    incomePredictability: confidenceNumber(
      row.incomePredictability,
      "financial_state_invalid_confidence",
    ),
    expensePredictability: confidenceNumber(
      row.expensePredictability,
      "financial_state_invalid_confidence",
    ),
    obligationCompleteness: confidenceNumber(
      row.obligationCompleteness,
      "financial_state_invalid_confidence",
    ),
    reconciliationQuality: confidenceNumber(
      row.reconciliationQuality,
      "financial_state_invalid_confidence",
    ),
    overall: confidenceNumber(row.overall, "financial_state_invalid_confidence"),
  };
}

function parseExplanationRefs(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error("financial_state_invalid_explanation_refs");
  }
  return value.map((item) =>
    stringValue(item, "financial_state_invalid_explanation_refs", 512),
  );
}

export function parsePersistedFinancialContextRow(
  value: unknown,
  trustedUserId: string,
): PersistedFinancialContextRecord {
  if (!UUID.test(trustedUserId)) throw new Error("financial_state_invalid_trusted_user");

  const row = object(value, "financial_state_invalid_context_row");
  const userId = uuid(row.usuario_id, "financial_state_invalid_context_owner");
  if (userId !== trustedUserId) throw new Error("financial_state_owner_mismatch");

  const status = stringValue(row.status, "financial_state_invalid_status", 32) as FinancialStatus;
  if (!FINANCIAL_STATUSES.has(status)) throw new Error("financial_state_invalid_status");

  const revision = stringValue(row.revision, "financial_state_invalid_revision", 80);
  if (!CONTEXT_REVISION.test(revision)) throw new Error("financial_state_invalid_revision");

  if (typeof row.sources_fresh !== "boolean") {
    throw new Error("financial_state_invalid_sources_fresh");
  }

  const horizonUntil = iso(row.horizon_until, "financial_state_invalid_horizon")!;
  const generatedAt = iso(row.generated_at, "financial_state_invalid_generated_at")!;
  const validUntil = iso(row.valid_until, "financial_state_invalid_valid_until", true);
  const minimumProjectedCashAt = iso(
    row.minimum_projected_cash_at,
    "financial_state_invalid_minimum_cash_at",
    true,
  );
  const horizonTime = new Date(horizonUntil).getTime();
  const generatedTime = new Date(generatedAt).getTime();
  const validTime = validUntil ? new Date(validUntil).getTime() : null;
  const minimumCashTime = minimumProjectedCashAt
    ? new Date(minimumProjectedCashAt).getTime()
    : null;

  if (generatedTime > horizonTime) {
    throw new Error("financial_state_generated_after_horizon");
  }
  if (validTime !== null && validTime > horizonTime) {
    throw new Error("financial_state_validity_exceeds_horizon");
  }
  if (minimumCashTime !== null && minimumCashTime > horizonTime) {
    throw new Error("financial_state_minimum_cash_outside_horizon");
  }

  return {
    userId,
    revision,
    currency: currency(row.currency, "financial_state_invalid_currency"),
    status,
    horizonUntil,
    liquidityUsableMinor: safeInteger(
      row.liquidity_usable_minor,
      "financial_state_invalid_liquidity",
    ),
    protectedCommitmentsMinor: safeInteger(
      row.protected_commitments_minor,
      "financial_state_invalid_commitments",
    ),
    protectedReserveMinor: safeInteger(
      row.protected_reserve_minor,
      "financial_state_invalid_reserve",
    ),
    availableRealSafeMinor: safeInteger(
      row.available_real_safe_minor,
      "financial_state_invalid_available",
    ),
    minimumProjectedCashMinor: safeInteger(
      row.minimum_projected_cash_minor,
      "financial_state_invalid_minimum_cash",
      true,
    ),
    minimumProjectedCashAt,
    confidence: parseConfidence(row.confidence),
    explanationRefs: parseExplanationRefs(row.explanation_refs),
    sourcesFresh: row.sources_fresh,
    generatedAt,
    validUntil,
  };
}

export function parsePersistedFinancialObligationRow(
  value: unknown,
  trustedUserId: string,
  expectedCurrency: string,
): FinancialObligation {
  if (!UUID.test(trustedUserId)) throw new Error("financial_state_invalid_trusted_user");
  if (!CURRENCY.test(expectedCurrency)) throw new Error("financial_state_invalid_currency");

  const row = object(value, "financial_state_invalid_obligation_row");
  const userId = uuid(row.usuario_id, "financial_state_invalid_obligation_owner");
  if (userId !== trustedUserId) throw new Error("financial_state_obligation_owner_mismatch");

  const parsedCurrency = currency(
    row.currency,
    "financial_state_invalid_obligation_currency",
  );
  if (parsedCurrency !== expectedCurrency) {
    throw new Error("financial_state_obligation_currency_mismatch");
  }
  if (typeof row.must_protect !== "boolean") {
    throw new Error("financial_state_invalid_obligation_protection");
  }

  return {
    // Preserve the deterministic obligation identity used by the context
    // fingerprint/explanation contract. The database UUID is storage metadata,
    // not the financial identity needed by the resolver.
    id: stringValue(row.source_key, "financial_state_invalid_obligation_id", 512),
    userId,
    type: stringValue(row.obligation_type, "financial_state_invalid_obligation_type", 128),
    amountMinor: safeInteger(row.amount_minor, "financial_state_invalid_obligation_amount"),
    currency: parsedCurrency,
    dueAt: iso(row.due_at, "financial_state_invalid_obligation_due_at")!,
    priority: safeInteger(row.priority, "financial_state_invalid_obligation_priority", true),
    mustProtect: row.must_protect,
    confidence: confidenceNumber(row.confidence, "financial_state_invalid_obligation_confidence"),
    source: stringValue(row.source, "financial_state_invalid_obligation_source", 128),
  };
}

function readError(prefix: string, error: { code?: string | null } | null) {
  if (!error) return null;
  return new Error(`${prefix}:${error.code || "unknown"}`);
}

/**
 * Read-only Supabase adapter for the server-side Financial State resolver.
 *
 * It uses the authenticated server client/RLS and still applies explicit
 * usuario_id predicates as defense in depth. It never reads raw Ledger or
 * ingestion tables for the user-facing state endpoint.
 */
export class SupabaseFinancialStateReader implements FinancialStateReader {
  constructor(
    private readonly client: Pick<SupabaseClient, "from">,
    private readonly trustedUserId: string,
  ) {
    if (!UUID.test(trustedUserId)) throw new Error("financial_state_invalid_trusted_user");
  }

  async getLatestContext(userId: string): Promise<PersistedFinancialContextRecord | null> {
    if (userId !== this.trustedUserId) throw new Error("financial_state_user_mismatch");

    const { data, error } = await this.client
      .from("eos_financial_contexts_v1")
      .select(CONTEXT_COLUMNS)
      .eq("usuario_id", this.trustedUserId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const failure = readError("financial_state_context_read_failed", error);
    if (failure) throw failure;
    if (!data) return null;
    return parsePersistedFinancialContextRow(data, this.trustedUserId);
  }

  async getOpenObligations(input: {
    userId: string;
    currency: string;
    horizonUntil: string;
  }): Promise<FinancialObligation[]> {
    if (input.userId !== this.trustedUserId) throw new Error("financial_state_user_mismatch");
    iso(input.horizonUntil, "financial_state_invalid_horizon");
    if (!CURRENCY.test(input.currency)) throw new Error("financial_state_invalid_currency");

    const { data, error } = await this.client
      .from("eos_financial_obligations_v1")
      .select(OBLIGATION_COLUMNS)
      .eq("usuario_id", this.trustedUserId)
      .eq("currency", input.currency)
      .eq("status", "open")
      .lte("due_at", input.horizonUntil)
      .order("due_at", { ascending: true });

    const failure = readError("financial_state_obligations_read_failed", error);
    if (failure) throw failure;
    if (!Array.isArray(data)) throw new Error("financial_state_invalid_obligations_response");

    return data.map((row) =>
      parsePersistedFinancialObligationRow(row, this.trustedUserId, input.currency),
    );
  }
}
