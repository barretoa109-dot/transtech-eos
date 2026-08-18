import type { LedgerEntry } from "./types";

export interface CardLiabilitySnapshot {
  cardAccountId: string;
  currency: string;
  asOf: string;
  openingLiabilityMinor: number;
  purchasesMinor: number;
  refundsMinor: number;
  paymentsMinor: number;
  outstandingMinor: number;
  sourceEntryIds: string[];
}

function occursBy(entry: LedgerEntry, asOfMs: number) {
  const when = new Date(entry.postedAt ?? entry.occurredAt).getTime();
  return Number.isFinite(when) && when <= asOfMs;
}

function paymentTargetsCard(entry: LedgerEntry, cardAccountId: string) {
  if (entry.type !== "card_payment") return false;
  return (
    entry.accountId === cardAccountId ||
    entry.counterpartyRef === cardAccountId ||
    entry.counterpartyRef === `card:${cardAccountId}`
  );
}

export function calculateCardLiability(
  cardAccountId: string,
  entries: LedgerEntry[],
  currency: string,
  asOf: string,
  openingLiabilityMinor = 0,
): CardLiabilitySnapshot {
  const asOfMs = new Date(asOf).getTime();
  if (!Number.isFinite(asOfMs)) throw new Error("asOf must be a valid date");
  if (!Number.isFinite(openingLiabilityMinor) || openingLiabilityMinor < 0) {
    throw new Error("openingLiabilityMinor must be finite and non-negative");
  }

  let purchasesMinor = 0;
  let refundsMinor = 0;
  let paymentsMinor = 0;
  const sourceEntryIds: string[] = [];

  for (const entry of entries) {
    if (entry.currency !== currency || entry.status !== "posted" || !occursBy(entry, asOfMs)) continue;

    const isCardPurchase =
      entry.accountId === cardAccountId &&
      entry.direction === "debit" &&
      ["expense", "fee", "tax"].includes(entry.type);

    const isCardRefund =
      entry.accountId === cardAccountId &&
      entry.direction === "credit" &&
      entry.type === "refund";

    if (isCardPurchase) {
      purchasesMinor += entry.amountMinor;
      sourceEntryIds.push(entry.id);
      continue;
    }

    if (isCardRefund) {
      refundsMinor += entry.amountMinor;
      sourceEntryIds.push(entry.id);
      continue;
    }

    if (paymentTargetsCard(entry, cardAccountId)) {
      paymentsMinor += entry.amountMinor;
      sourceEntryIds.push(entry.id);
    }
  }

  return {
    cardAccountId,
    currency,
    asOf,
    openingLiabilityMinor: Math.trunc(openingLiabilityMinor),
    purchasesMinor,
    refundsMinor,
    paymentsMinor,
    outstandingMinor: Math.max(
      0,
      Math.trunc(openingLiabilityMinor + purchasesMinor - refundsMinor - paymentsMinor),
    ),
    sourceEntryIds,
  };
}
