import type { LedgerEntry } from "./types";

export interface DetectedRecurrence {
  key: string;
  direction: "credit" | "debit";
  currency: string;
  cadence: "daily" | "weekly" | "biweekly" | "monthly" | "irregular";
  expectedAmountMinor: number;
  amountMinMinor: number;
  amountMaxMinor: number;
  medianIntervalDays: number;
  nextExpectedAt: string;
  confidence: number;
  sourceEntryIds: string[];
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function normalizedKey(entry: LedgerEntry) {
  const identity =
    entry.counterpartyRef ??
    entry.merchantNormalized ??
    entry.descriptionRaw
      .toLowerCase()
      .replace(/\d+/g, "#")
      .replace(/\s+/g, " ")
      .trim();
  return `${entry.userId}|${entry.direction}|${entry.currency}|${identity}`;
}

function cadenceFor(days: number): DetectedRecurrence["cadence"] {
  if (days >= 0.75 && days <= 1.5) return "daily";
  if (days >= 5.5 && days <= 8.5) return "weekly";
  if (days >= 12 && days <= 16.5) return "biweekly";
  if (days >= 25 && days <= 35) return "monthly";
  return "irregular";
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  date.setUTCSeconds(date.getUTCSeconds() + Math.round(days * 86400));
  return date.toISOString();
}

export function detectRecurringPatterns(entries: LedgerEntry[]): DetectedRecurrence[] {
  const eligible = entries.filter(
    (entry) =>
      entry.status === "posted" &&
      (entry.direction === "credit" || entry.direction === "debit") &&
      ![
        "internal_transfer",
        "card_payment",
        "investment_contribution",
        "investment_withdrawal",
        "cash_withdrawal",
        "cash_deposit",
      ].includes(entry.type),
  );

  const groups = new Map<string, LedgerEntry[]>();
  for (const entry of eligible) {
    const key = normalizedKey(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const detected: DetectedRecurrence[] = [];

  for (const [key, group] of groups) {
    if (group.length < 3) continue;
    const ordered = [...group].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    const intervals = ordered.slice(1).map((entry, index) => {
      const prior = ordered[index];
      return (
        (new Date(entry.occurredAt).getTime() - new Date(prior.occurredAt).getTime()) /
        86400000
      );
    });

    const medianIntervalDays = median(intervals);
    const cadence = cadenceFor(medianIntervalDays);
    if (cadence === "irregular") continue;

    const amounts = ordered.map((entry) => entry.amountMinor);
    const expectedAmountMinor = Math.round(median(amounts));
    const intervalDeviation = median(
      intervals.map((value) => Math.abs(value - medianIntervalDays)),
    );
    const amountDeviationRatio =
      expectedAmountMinor === 0
        ? 1
        : median(amounts.map((value) => Math.abs(value - expectedAmountMinor))) /
          expectedAmountMinor;

    const cadenceTolerance = cadence === "monthly" ? 5 : cadence === "biweekly" ? 2 : 1;
    const intervalScore = Math.max(0, 1 - intervalDeviation / cadenceTolerance);
    const amountScore = Math.max(0, 1 - amountDeviationRatio);
    const evidenceScore = Math.min(1, ordered.length / 6);
    const confidence = Math.max(
      0,
      Math.min(1, 0.5 * intervalScore + 0.3 * amountScore + 0.2 * evidenceScore),
    );

    const last = ordered[ordered.length - 1];
    detected.push({
      key,
      direction: last.direction as "credit" | "debit",
      currency: last.currency,
      cadence,
      expectedAmountMinor,
      amountMinMinor: Math.min(...amounts),
      amountMaxMinor: Math.max(...amounts),
      medianIntervalDays,
      nextExpectedAt: addDays(last.occurredAt, medianIntervalDays),
      confidence,
      sourceEntryIds: ordered.map((entry) => entry.id),
    });
  }

  return detected.sort((a, b) => b.confidence - a.confidence);
}
