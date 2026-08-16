import type { LedgerEntry, ForecastEvent } from "./types";
import type { DetectedRecurrence } from "./recurrence";

export type BehavioralPatternRole =
  | "salary"
  | "rent_or_mortgage"
  | "utility"
  | "loan_installment"
  | "insurance"
  | "education"
  | "subscription"
  | "recurring_income"
  | "recurring_expense";

export interface InferredFinancialPattern {
  recurrenceKey: string;
  role: BehavioralPatternRole;
  direction: "credit" | "debit";
  currency: string;
  cadence: DetectedRecurrence["cadence"];
  expectedAmountMinor: number;
  nextExpectedAt: string;
  essentiality: ForecastEvent["essentiality"];
  confidence: number;
  sourceEntryIds: string[];
  reasonCodes: string[];
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sourceText(recurrence: DetectedRecurrence, entriesById: ReadonlyMap<string, LedgerEntry>) {
  return recurrence.sourceEntryIds
    .map((id) => entriesById.get(id))
    .filter((entry): entry is LedgerEntry => Boolean(entry))
    .map((entry) =>
      [entry.descriptionRaw, entry.merchantNormalized, entry.category, entry.subcategory]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
}

function containsAny(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(token));
}

export function inferFinancialPatterns(
  recurrences: DetectedRecurrence[],
  entries: LedgerEntry[],
): InferredFinancialPattern[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  return recurrences.map((recurrence) => {
    const text = normalizeText(sourceText(recurrence, entriesById));
    let role: BehavioralPatternRole =
      recurrence.direction === "credit" ? "recurring_income" : "recurring_expense";
    let essentiality: ForecastEvent["essentiality"] =
      recurrence.direction === "credit" ? "essential" : "flexible";
    const reasonCodes: string[] = [];
    let semanticBoost = 0;

    if (
      recurrence.direction === "credit" &&
      containsAny(text, ["sueldo", "salario", "haberes", "nomina", "payroll", "salary"])
    ) {
      role = "salary";
      essentiality = "essential";
      reasonCodes.push("salary_semantic_match");
      semanticBoost = 0.08;
    } else if (
      recurrence.direction === "debit" &&
      containsAny(text, ["alquiler", "rent", "hipoteca", "mortgage"])
    ) {
      role = "rent_or_mortgage";
      essentiality = "critical";
      reasonCodes.push("housing_semantic_match");
      semanticBoost = 0.1;
    } else if (
      recurrence.direction === "debit" &&
      containsAny(text, ["prestamo", "credito", "loan", "cuota prestamo", "installment"])
    ) {
      role = "loan_installment";
      essentiality = "critical";
      reasonCodes.push("loan_semantic_match");
      semanticBoost = 0.08;
    } else if (
      recurrence.direction === "debit" &&
      containsAny(text, ["ande", "essap", "electricidad", "agua", "internet", "telefon", "utility"])
    ) {
      role = "utility";
      essentiality = "essential";
      reasonCodes.push("utility_semantic_match");
      semanticBoost = 0.07;
    } else if (
      recurrence.direction === "debit" &&
      containsAny(text, ["seguro", "insurance"])
    ) {
      role = "insurance";
      essentiality = "essential";
      reasonCodes.push("insurance_semantic_match");
      semanticBoost = 0.07;
    } else if (
      recurrence.direction === "debit" &&
      containsAny(text, ["colegio", "universidad", "education", "school", "matricula"])
    ) {
      role = "education";
      essentiality = "essential";
      reasonCodes.push("education_semantic_match");
      semanticBoost = 0.07;
    } else if (
      recurrence.direction === "debit" &&
      containsAny(text, ["netflix", "spotify", "youtube", "icloud", "google one", "adobe", "subscription"])
    ) {
      role = "subscription";
      essentiality = "optional";
      reasonCodes.push("subscription_semantic_match");
      semanticBoost = 0.08;
    } else {
      reasonCodes.push("generic_recurrence_role");
    }

    if (recurrence.cadence === "monthly") reasonCodes.push("monthly_cadence");
    if (recurrence.sourceEntryIds.length >= 4) reasonCodes.push("multi_cycle_evidence");

    return {
      recurrenceKey: recurrence.key,
      role,
      direction: recurrence.direction,
      currency: recurrence.currency,
      cadence: recurrence.cadence,
      expectedAmountMinor: recurrence.expectedAmountMinor,
      nextExpectedAt: recurrence.nextExpectedAt,
      essentiality,
      confidence: Math.min(1, recurrence.confidence + semanticBoost),
      sourceEntryIds: recurrence.sourceEntryIds,
      reasonCodes,
    };
  });
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addCalendarMonth(iso: string) {
  const date = new Date(iso);
  const sourceDay = date.getUTCDate();
  const sourceHours = date.getUTCHours();
  const sourceMinutes = date.getUTCMinutes();
  const sourceSeconds = date.getUTCSeconds();
  const sourceMs = date.getUTCMilliseconds();

  const firstOfTarget = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, sourceHours, sourceMinutes, sourceSeconds, sourceMs),
  );
  const daysInTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();

  firstOfTarget.setUTCDate(Math.min(sourceDay, daysInTarget));
  return firstOfTarget.toISOString();
}

function nextOccurrence(pattern: InferredFinancialPattern, current: string) {
  switch (pattern.cadence) {
    case "daily":
      return addDays(current, 1);
    case "weekly":
      return addDays(current, 7);
    case "biweekly":
      return addDays(current, 14);
    case "monthly":
      return addCalendarMonth(current);
    default:
      return addDays(current, Math.max(1, Math.round(30)));
  }
}

export function materializePatternForecast(
  pattern: InferredFinancialPattern,
  horizonUntil: string,
): ForecastEvent[] {
  const horizon = new Date(horizonUntil).getTime();
  if (!Number.isFinite(horizon)) throw new Error("horizonUntil must be valid");

  const events: ForecastEvent[] = [];
  let next = pattern.nextExpectedAt;
  let occurrence = 1;

  while (new Date(next).getTime() <= horizon && occurrence <= 120) {
    events.push({
      id: `recurrence:${pattern.recurrenceKey}:${occurrence}`,
      date: next,
      type: pattern.direction === "credit" ? "income" : "expense",
      amountMinor: pattern.expectedAmountMinor,
      direction: pattern.direction,
      confidence: pattern.confidence,
      probability: pattern.confidence,
      essentiality: pattern.essentiality,
      sourceRef: `recurrence:${pattern.recurrenceKey}`,
    });
    next = nextOccurrence(pattern, next);
    occurrence += 1;
  }

  return events;
}
