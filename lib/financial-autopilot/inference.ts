import { materializePatternForecast, type InferredFinancialPattern } from "./behavior";
import type { FinancialObligation, ForecastEvent, LedgerEntry } from "./types";

export interface PrimaryFinancialHorizon {
  until: string;
  reason: "next_high_confidence_income" | "rolling_fallback";
  incomePatternRef: string | null;
  confidence: number;
}

export interface EssentialSpendEstimate {
  expectedMinor: number;
  weeklyExpectedMinor: number;
  confidence: number;
  sampleCount: number;
  observationDays: number;
  sourceEntryIds: string[];
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function resolvePrimaryFinancialHorizon(
  patterns: InferredFinancialPattern[],
  asOf: string,
  fallbackDays = 30,
  minimumIncomeConfidence = 0.9,
): PrimaryFinancialHorizon {
  const asOfMs = new Date(asOf).getTime();
  if (!Number.isFinite(asOfMs)) throw new Error("asOf must be valid");

  const nextIncome = patterns
    .filter((pattern) => pattern.direction === "credit")
    .filter((pattern) => ["salary", "recurring_income"].includes(pattern.role))
    .filter((pattern) => pattern.confidence >= minimumIncomeConfidence)
    .map((pattern) => ({ pattern, time: new Date(pattern.nextExpectedAt).getTime() }))
    .filter(({ time }) => Number.isFinite(time) && time >= asOfMs)
    .sort((a, b) => a.time - b.time)[0];

  if (nextIncome) {
    return {
      until: nextIncome.pattern.nextExpectedAt,
      reason: "next_high_confidence_income",
      incomePatternRef: nextIncome.pattern.recurrenceKey,
      confidence: nextIncome.pattern.confidence,
    };
  }

  return {
    until: addDays(asOf, fallbackDays),
    reason: "rolling_fallback",
    incomePatternRef: null,
    confidence: 0,
  };
}

function obligationPolicy(role: InferredFinancialPattern["role"]) {
  switch (role) {
    case "rent_or_mortgage":
      return { type: "housing", priority: 100, mustProtect: true };
    case "loan_installment":
      return { type: "loan_installment", priority: 100, mustProtect: true };
    case "utility":
      return { type: "utility", priority: 85, mustProtect: true };
    case "insurance":
      return { type: "insurance", priority: 85, mustProtect: true };
    case "education":
      return { type: "education", priority: 85, mustProtect: true };
    case "subscription":
      return { type: "subscription", priority: 30, mustProtect: false };
    default:
      return { type: "recurring_expense", priority: 50, mustProtect: false };
  }
}

export function inferObligationsFromPatterns(input: {
  userId: string;
  patterns: InferredFinancialPattern[];
  horizonUntil: string;
  minimumConfidence?: number;
}): FinancialObligation[] {
  const minimumConfidence = input.minimumConfidence ?? 0.75;
  const obligations: FinancialObligation[] = [];

  for (const pattern of input.patterns) {
    if (pattern.direction !== "debit" || pattern.confidence < minimumConfidence) continue;
    const policy = obligationPolicy(pattern.role);
    const events = materializePatternForecast(pattern, input.horizonUntil);

    events.forEach((event, index) => {
      obligations.push({
        id: `inferred:${pattern.recurrenceKey}:${index + 1}`,
        userId: input.userId,
        type: policy.type,
        amountMinor: event.amountMinor,
        currency: pattern.currency,
        dueAt: event.date,
        priority: policy.priority,
        mustProtect: policy.mustProtect,
        confidence: pattern.confidence,
        source: `inferred_recurrence:${pattern.recurrenceKey}`,
      });
    });
  }

  return obligations.sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );
}

export function confirmedIncomeWithinHorizon(input: {
  patterns: InferredFinancialPattern[];
  asOf: string;
  horizonUntil: string;
  minimumConfidence?: number;
}): { amountMinor: number; events: ForecastEvent[] } {
  const minimumConfidence = input.minimumConfidence ?? 0.9;
  const asOfMs = new Date(input.asOf).getTime();
  const horizonMs = new Date(input.horizonUntil).getTime();
  if (!Number.isFinite(asOfMs) || !Number.isFinite(horizonMs)) throw new Error("invalid horizon");

  const events = input.patterns
    .filter((pattern) => pattern.direction === "credit")
    .filter((pattern) => pattern.confidence >= minimumConfidence)
    .flatMap((pattern) => materializePatternForecast(pattern, input.horizonUntil))
    .filter((event) => {
      const time = new Date(event.date).getTime();
      return time >= asOfMs && time <= horizonMs && (event.probability ?? 1) >= minimumConfidence;
    });

  return {
    amountMinor: events.reduce((sum, event) => sum + event.amountMinor, 0),
    events,
  };
}

const ESSENTIAL_TOKENS = [
  "supermercado",
  "grocery",
  "food",
  "comida",
  "combustible",
  "fuel",
  "farmacia",
  "pharmacy",
  "salud",
  "health",
  "transporte",
  "transport",
];

function isVariableEssential(entry: LedgerEntry) {
  const text = [
    entry.category,
    entry.subcategory,
    entry.merchantNormalized,
    entry.descriptionRaw,
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return ESSENTIAL_TOKENS.some((token) => text.includes(token));
}

function percentile75(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1);
  return sorted[index];
}

export function estimateVariableEssentialSpend(input: {
  entries: LedgerEntry[];
  patterns: InferredFinancialPattern[];
  currency: string;
  asOf: string;
  horizonUntil: string;
  observationDays?: number;
}): EssentialSpendEstimate {
  const observationDays = input.observationDays ?? 60;
  const asOfMs = new Date(input.asOf).getTime();
  const horizonMs = new Date(input.horizonUntil).getTime();
  if (!Number.isFinite(asOfMs) || !Number.isFinite(horizonMs)) throw new Error("invalid date");

  const recurringSourceIds = new Set(input.patterns.flatMap((pattern) => pattern.sourceEntryIds));
  const windowStartMs = new Date(addDays(input.asOf, -observationDays)).getTime();

  const eligible = input.entries.filter((entry) => {
    const time = new Date(entry.postedAt ?? entry.occurredAt).getTime();
    return (
      entry.currency === input.currency &&
      entry.status === "posted" &&
      entry.direction === "debit" &&
      ["expense", "fee", "tax"].includes(entry.type) &&
      !recurringSourceIds.has(entry.id) &&
      Number.isFinite(time) &&
      time >= windowStartMs &&
      time <= asOfMs &&
      isVariableEssential(entry)
    );
  });

  if (eligible.length === 0) {
    return {
      expectedMinor: 0,
      weeklyExpectedMinor: 0,
      confidence: 0,
      sampleCount: 0,
      observationDays,
      sourceEntryIds: [],
    };
  }

  const weekBuckets = new Map<number, number>();
  for (const entry of eligible) {
    const time = new Date(entry.postedAt ?? entry.occurredAt).getTime();
    const daysAgo = Math.max(0, Math.floor((asOfMs - time) / 86400000));
    const bucket = Math.floor(daysAgo / 7);
    weekBuckets.set(bucket, (weekBuckets.get(bucket) ?? 0) + entry.amountMinor);
  }

  const completeWeeks = Math.max(1, Math.ceil(observationDays / 7));
  const weeklyTotals = Array.from({ length: completeWeeks }, (_, index) => weekBuckets.get(index) ?? 0);
  const weeklyExpectedMinor = percentile75(weeklyTotals);
  const horizonDays = Math.max(1, Math.ceil((horizonMs - asOfMs) / 86400000));
  const expectedMinor = Math.round((weeklyExpectedMinor / 7) * horizonDays);
  const sampleScore = Math.min(1, eligible.length / 12);
  const activeWeekScore = Math.min(1, weekBuckets.size / Math.min(8, completeWeeks));
  const confidence = Math.min(1, 0.6 * sampleScore + 0.4 * activeWeekScore);

  return {
    expectedMinor,
    weeklyExpectedMinor,
    confidence,
    sampleCount: eligible.length,
    observationDays,
    sourceEntryIds: eligible.map((entry) => entry.id),
  };
}
