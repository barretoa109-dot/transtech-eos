import type { LedgerEntry, ReconciliationMatch } from "./types";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function timeDiffMs(a: string, b: string) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime());
}

function sameMoney(a: LedgerEntry, b: LedgerEntry) {
  return a.currency === b.currency && Math.abs(a.amountMinor) === Math.abs(b.amountMinor);
}

export function findDeterministicReconciliations(entries: LedgerEntry[]): ReconciliationMatch[] {
  const matches: ReconciliationMatch[] = [];
  const used = new Set<string>();

  const byExternal = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    if (!entry.externalTransactionId) continue;
    const key = `${entry.userId}:${entry.accountId}:${entry.externalTransactionId}`;
    const prior = byExternal.get(key);
    if (prior && prior.id !== entry.id) {
      matches.push({
        type: "duplicate",
        entryIds: [prior.id, entry.id],
        confidence: 1,
        reasonCode: "same_account_external_transaction_id",
      });
      used.add(prior.id);
      used.add(entry.id);
    } else {
      byExternal.set(key, entry);
    }
  }

  for (let i = 0; i < entries.length; i += 1) {
    const a = entries[i];
    if (used.has(a.id)) continue;

    for (let j = i + 1; j < entries.length; j += 1) {
      const b = entries[j];
      if (used.has(b.id) || a.userId !== b.userId || !sameMoney(a, b)) continue;

      const aWhen = a.postedAt ?? a.occurredAt;
      const bWhen = b.postedAt ?? b.occurredAt;

      if (
        a.accountId === b.accountId &&
        a.status === "pending" &&
        b.status === "posted" &&
        timeDiffMs(aWhen, bWhen) <= THREE_DAYS_MS
      ) {
        matches.push({
          type: "pending_to_posted",
          entryIds: [a.id, b.id],
          confidence: 0.99,
          reasonCode: "same_account_amount_pending_then_posted",
        });
        used.add(a.id);
        used.add(b.id);
        break;
      }

      const oppositeDirections =
        (a.direction === "debit" && b.direction === "credit") ||
        (a.direction === "credit" && b.direction === "debit");

      if (
        a.accountId !== b.accountId &&
        oppositeDirections &&
        timeDiffMs(aWhen, bWhen) <= TEN_MINUTES_MS
      ) {
        matches.push({
          type: "internal_transfer_match",
          entryIds: [a.id, b.id],
          confidence: 0.97,
          reasonCode: "equal_opposite_amount_between_user_accounts",
        });
        used.add(a.id);
        used.add(b.id);
        break;
      }

      const refundPair =
        ((a.type === "expense" && b.type === "refund") ||
          (a.type === "refund" && b.type === "expense")) &&
        timeDiffMs(aWhen, bWhen) <= THREE_DAYS_MS;

      if (refundPair) {
        matches.push({
          type: "refund_match",
          entryIds: [a.id, b.id],
          confidence: 0.95,
          reasonCode: "equal_amount_expense_refund_pair",
        });
        used.add(a.id);
        used.add(b.id);
        break;
      }
    }
  }

  return matches;
}
