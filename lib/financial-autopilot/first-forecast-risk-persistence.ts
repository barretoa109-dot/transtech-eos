import type { FinancialStateRiskView } from "./financial-state";
import type { ForecastHorizonsResult } from "./forecast-horizons";
import {
  buildFinancialPersistencePlan,
  sha256FinancialFingerprint,
  type FinancialContextInsert,
  type FinancialPersistencePlan,
} from "./persistence";
import type { FinancialConnectorSnapshot } from "./types";
import type { ZeroEntryAutopilotResult } from "./zero-entry";

const SHA256_HEX = /^[a-f0-9]{64}$/;

export type FirstForecastRiskInput = ForecastHorizonsResult["firstRisk"];

export interface FinancialContextInsertV1_1 extends FinancialContextInsert {
  firstForecastRisk: FinancialStateRiskView | null;
}

export interface FinancialPersistencePlanV1_1
  extends Omit<FinancialPersistencePlan, "contextInsert"> {
  contextInsert: FinancialContextInsertV1_1;
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function safeNonNegativeInteger(value: unknown, code: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function positiveSafeInteger(value: unknown, code: string) {
  const parsed = safeNonNegativeInteger(value, code);
  if (parsed <= 0) throw new Error(code);
  return parsed;
}

function iso(value: unknown, code: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    throw new Error(code);
  }
  return value;
}

/** Strict persisted JSON parser shared by the writer and read adapter. */
export function parsePersistedFirstForecastRisk(
  value: unknown,
): FinancialStateRiskView | null {
  if (value === null) return null;

  const code = "financial_state_invalid_first_forecast_risk";
  const row = object(value, code);
  if (row.status !== "ATTENTION" && row.status !== "ACTION_REQUIRED") {
    throw new Error(code);
  }

  const horizonDays = positiveSafeInteger(row.horizonDays, code);
  const until = iso(row.until, code);
  const reserveGapMinor = safeNonNegativeInteger(row.reserveGapMinor, code);
  const negativeCashGapMinor = safeNonNegativeInteger(row.negativeCashGapMinor, code);

  // Keep the persistence boundary semantically identical to the deterministic
  // 30/60/90 forecast contract. Invalid combinations must never become part of
  // a context revision and later look authoritative merely because they were
  // persisted successfully.
  if (
    row.status === "ATTENTION" &&
    (reserveGapMinor <= 0 || negativeCashGapMinor !== 0)
  ) {
    throw new Error(code);
  }
  if (
    row.status === "ACTION_REQUIRED" &&
    (negativeCashGapMinor <= 0 || reserveGapMinor < negativeCashGapMinor)
  ) {
    throw new Error(code);
  }

  return {
    status: row.status,
    horizonDays,
    until,
    reserveGapMinor,
    negativeCashGapMinor,
  };
}

export function toPersistedFirstForecastRisk(
  risk: FirstForecastRiskInput,
): FinancialStateRiskView | null {
  if (!risk) return null;
  return parsePersistedFirstForecastRisk({
    status: risk.status,
    horizonDays: risk.days,
    until: risk.until,
    reserveGapMinor: risk.reserveGapMinor,
    negativeCashGapMinor: risk.negativeCashGapMinor,
  });
}

/**
 * Upgrades the existing v1 persistence plan without changing the v1 batch
 * discriminator expected by the underlying atomic RPC. The new context identity
 * commits to both the full v1 fingerprint and the compact first forecast risk.
 */
export function upgradeFinancialPersistencePlanWithFirstForecastRisk(input: {
  plan: FinancialPersistencePlan;
  firstRisk: FirstForecastRiskInput;
}): FinancialPersistencePlanV1_1 {
  const baseFingerprint = input.plan.contextInsert.sourceFingerprint;
  if (
    !SHA256_HEX.test(baseFingerprint) ||
    input.plan.contextInsert.revision !== `ctx:${baseFingerprint}`
  ) {
    throw new Error("financial_persistence_invalid_base_context_identity");
  }
  if (input.plan.contextInsert.userId !== input.plan.userId) {
    throw new Error("financial_persistence_context_user_mismatch");
  }

  const firstForecastRisk = toPersistedFirstForecastRisk(input.firstRisk);
  const sourceFingerprint = sha256FinancialFingerprint({
    contract: "financial-context-first-forecast-risk-v1.1",
    baseFingerprint,
    firstForecastRisk,
  });

  return {
    ...input.plan,
    contextInsert: {
      ...input.plan.contextInsert,
      sourceFingerprint,
      revision: `ctx:${sourceFingerprint}`,
      firstForecastRisk,
    },
  };
}

export function buildFinancialPersistencePlanV1_1(input: {
  snapshot: FinancialConnectorSnapshot;
  result: ZeroEntryAutopilotResult;
}): FinancialPersistencePlanV1_1 {
  const plan = buildFinancialPersistencePlan(input);
  return upgradeFinancialPersistencePlanWithFirstForecastRisk({
    plan,
    firstRisk: input.result.horizons.firstRisk,
  });
}
