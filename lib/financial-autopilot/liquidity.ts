import type { FinancialAccount } from "./types";

export interface LiquiditySnapshot {
  currency: string;
  usableMinor: number;
  includedAccountIds: string[];
  staleAccountIds: string[];
  excludedAccountIds: string[];
  sourcesFresh: boolean;
}

const LIQUID_TYPES = new Set<FinancialAccount["type"]>([
  "checking",
  "savings",
  "wallet",
  "cash",
]);

export function calculateUsableLiquidity(
  accounts: FinancialAccount[],
  currency: string,
  asOfIso: string,
): LiquiditySnapshot {
  const asOf = new Date(asOfIso).getTime();
  if (!Number.isFinite(asOf)) throw new Error("asOfIso must be a valid date");

  let usableMinor = 0;
  const includedAccountIds: string[] = [];
  const staleAccountIds: string[] = [];
  const excludedAccountIds: string[] = [];

  for (const account of accounts) {
    if (
      account.currency !== currency ||
      account.ownership === "external" ||
      !LIQUID_TYPES.has(account.type)
    ) {
      excludedAccountIds.push(account.id);
      continue;
    }

    const freshUntil = account.freshUntil ? new Date(account.freshUntil).getTime() : Number.NaN;
    const isFresh = Number.isFinite(freshUntil) && freshUntil >= asOf;
    if (!isFresh) {
      staleAccountIds.push(account.id);
      continue;
    }

    const balance = account.availableBalanceMinor ?? account.ledgerBalanceMinor;
    if (balance === null || !Number.isFinite(balance)) {
      staleAccountIds.push(account.id);
      continue;
    }

    usableMinor += Math.max(0, Math.trunc(balance));
    includedAccountIds.push(account.id);
  }

  return {
    currency,
    usableMinor,
    includedAccountIds,
    staleAccountIds,
    excludedAccountIds,
    sourcesFresh: staleAccountIds.length === 0,
  };
}
