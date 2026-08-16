import { inferFinancialPatterns, materializePatternForecast } from "./behavior";
import { detectRecurringPatterns } from "./recurrence";
import type { LedgerEntry } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000020";
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000020";

function row(
  id: string,
  direction: "credit" | "debit",
  amountMinor: number,
  occurredAt: string,
  descriptionRaw: string,
  category: string | null = null,
  subcategory: string | null = null,
): LedgerEntry {
  return {
    id,
    userId: USER_ID,
    accountId: ACCOUNT_ID,
    sourceEventId: `event:${id}`,
    externalTransactionId: `external:${id}`,
    type: direction === "credit" ? "income" : "expense",
    direction,
    status: "posted",
    amountMinor,
    currency: "PYG",
    occurredAt,
    postedAt: occurredAt,
    descriptionRaw,
    merchantNormalized: null,
    category,
    subcategory,
    counterpartyRef: null,
    internalTransferGroupId: null,
    recurrenceId: null,
    reversalOf: null,
    confidence: 0.99,
    provenance: "behavior_fixture",
  };
}

export function runBehaviorInferenceScenario() {
  const entries: LedgerEntry[] = [
    row("salary-1", "credit", 9000000, "2026-05-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-2", "credit", 9000000, "2026-06-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-3", "credit", 9000000, "2026-07-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-4", "credit", 9000000, "2026-08-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),

    row("rent-1", "debit", 2100000, "2026-05-05T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-2", "debit", 2100000, "2026-06-05T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-3", "debit", 2100000, "2026-07-05T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-4", "debit", 2100000, "2026-08-05T12:00:00.000Z", "ALQUILER CASA"),

    row("utility-1", "debit", 310000, "2026-05-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("utility-2", "debit", 345000, "2026-06-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("utility-3", "debit", 330000, "2026-07-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("utility-4", "debit", 360000, "2026-08-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),

    row("subscription-1", "debit", 89000, "2026-05-12T12:00:00.000Z", "NETFLIX SUBSCRIPTION"),
    row("subscription-2", "debit", 89000, "2026-06-12T12:00:00.000Z", "NETFLIX SUBSCRIPTION"),
    row("subscription-3", "debit", 89000, "2026-07-12T12:00:00.000Z", "NETFLIX SUBSCRIPTION"),
    row("subscription-4", "debit", 89000, "2026-08-12T12:00:00.000Z", "NETFLIX SUBSCRIPTION"),
  ];

  const recurrences = detectRecurringPatterns(entries);
  const patterns = inferFinancialPatterns(recurrences, entries);
  const forecast = patterns.flatMap((pattern) =>
    materializePatternForecast(pattern, "2026-10-31T23:59:59.000Z"),
  );

  const salary = patterns.find((pattern) => pattern.role === "salary");
  const rent = patterns.find((pattern) => pattern.role === "rent_or_mortgage");
  const utility = patterns.find((pattern) => pattern.role === "utility");
  const subscription = patterns.find((pattern) => pattern.role === "subscription");

  const checks = {
    fourMonthlyPatternsDetected: recurrences.length === 4,
    salaryDetected: Boolean(salary && salary.direction === "credit" && salary.expectedAmountMinor === 9000000),
    rentProtectedAsCritical: Boolean(rent && rent.essentiality === "critical"),
    utilityDetectedAsEssential: Boolean(utility && utility.essentiality === "essential"),
    subscriptionDetectedAsOptional: Boolean(subscription && subscription.essentiality === "optional"),
    futureEventsMaterialized: forecast.length >= 8,
    futureIncomeUsesProbabilityWithoutShrinkingPrincipal: Boolean(
      salary &&
        forecast.some(
          (event) =>
            event.sourceRef === `recurrence:${salary.recurrenceKey}` &&
            event.amountMinor === 9000000 &&
            event.probability === salary.confidence,
        ),
    ),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    recurrences,
    patterns,
    forecast,
  };
}
