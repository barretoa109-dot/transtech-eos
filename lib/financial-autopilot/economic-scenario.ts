import { summarizeEconomicActivity } from "./economic-impact";
import { findDeterministicReconciliations } from "./reconciliation";
import type { FinancialAccount, LedgerEntry } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000009";
const CONNECTION_ID = "10000000-0000-4000-8000-000000000009";
const CHECKING_ID = "20000000-0000-4000-8000-000000000009";
const SAVINGS_ID = "20000000-0000-4000-8000-000000000010";
const CARD_ID = "20000000-0000-4000-8000-000000000011";

function account(
  id: string,
  type: FinancialAccount["type"],
  displayName: string,
): FinancialAccount {
  return {
    id,
    userId: USER_ID,
    externalAccountId: id,
    connectionId: CONNECTION_ID,
    type,
    institutionName: "Banco Demo Paraguay",
    displayName,
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 10000000,
    ledgerBalanceMinor: 10000000,
    balanceAsOf: "2026-08-16T01:00:00.000Z",
    freshUntil: "2026-08-16T07:00:00.000Z",
  };
}

function entry(
  id: string,
  accountId: string,
  type: LedgerEntry["type"],
  direction: LedgerEntry["direction"],
  amountMinor: number,
  occurredAt: string,
  overrides: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id,
    userId: USER_ID,
    accountId,
    sourceEventId: `event:${id}`,
    externalTransactionId: `external:${id}`,
    type,
    direction,
    status: "posted",
    amountMinor,
    currency: "PYG",
    occurredAt,
    postedAt: occurredAt,
    descriptionRaw: id,
    merchantNormalized: null,
    category: null,
    subcategory: null,
    counterpartyRef: null,
    internalTransferGroupId: null,
    recurrenceId: null,
    reversalOf: null,
    confidence: 0.99,
    provenance: "economic_semantics_fixture",
    ...overrides,
  };
}

export function runEconomicSemanticsScenario() {
  const accounts: FinancialAccount[] = [
    account(CHECKING_ID, "checking", "Cuenta principal"),
    account(SAVINGS_ID, "savings", "Ahorro"),
    account(CARD_ID, "card", "Tarjeta"),
  ];

  const entries: LedgerEntry[] = [
    entry("salary", CHECKING_ID, "income", "credit", 9000000, "2026-08-01T12:00:00.000Z"),
    entry("card-purchase", CARD_ID, "expense", "debit", 1200000, "2026-08-02T12:00:00.000Z"),
    entry("card-refund", CARD_ID, "refund", "credit", 200000, "2026-08-03T12:00:00.000Z"),
    entry("card-payment", CHECKING_ID, "card_payment", "debit", 1000000, "2026-08-10T12:00:00.000Z"),
    entry("transfer-out", CHECKING_ID, "internal_transfer", "debit", 500000, "2026-08-11T12:00:00.000Z"),
    entry("transfer-in", SAVINGS_ID, "internal_transfer", "credit", 500000, "2026-08-11T12:00:03.000Z"),
    entry("loan-draw", CHECKING_ID, "debt_draw", "credit", 3000000, "2026-08-12T12:00:00.000Z"),
    entry("loan-payment", CHECKING_ID, "debt_payment", "debit", 400000, "2026-08-13T12:00:00.000Z"),
    entry("grocery", CHECKING_ID, "expense", "debit", 300000, "2026-08-14T12:00:00.000Z"),
    entry("bank-fee", CHECKING_ID, "fee", "debit", 50000, "2026-08-14T13:00:00.000Z"),
    entry("pending-grocery", CHECKING_ID, "expense", "debit", 100000, "2026-08-15T12:00:00.000Z", {
      status: "pending",
      externalTransactionId: "pending:grocery",
    }),
    entry("posted-grocery", CHECKING_ID, "expense", "debit", 100000, "2026-08-15T12:02:00.000Z", {
      externalTransactionId: "posted:grocery",
    }),
    entry("reversed-fee", CHECKING_ID, "fee", "debit", 70000, "2026-08-15T15:00:00.000Z"),
    entry("fee-reversal", CHECKING_ID, "refund", "credit", 70000, "2026-08-15T15:05:00.000Z", {
      reversalOf: "reversed-fee",
    }),
  ];

  const reconciliation = findDeterministicReconciliations(entries);
  const summary = summarizeEconomicActivity(entries, accounts, "PYG", reconciliation);

  const checks = {
    cardPurchaseCountedOnce: summary.expenseMinor === 1650000,
    cardPaymentNotDoubleCounted:
      summary.effects.find((effect) => effect.entryId === "card-payment")?.expenseMinor === 0,
    refundOffsetsConsumption: summary.refundMinor === 200000,
    netConsumptionIs1450000: summary.netConsumptionMinor === 1450000,
    loanDrawIsNotIncome: summary.incomeMinor === 9000000,
    ownTransferIsNotConsumption:
      summary.effects
        .filter((effect) => effect.kind === "internal_transfer")
        .every((effect) => !effect.affectsConsumption),
    pendingPostedCountedOnce:
      reconciliation.some((match) => match.type === "pending_to_posted") &&
      summary.effects.some((effect) => effect.entryId === "posted-grocery") &&
      !summary.effects.some((effect) => effect.entryId === "pending-grocery"),
    explicitReversalNetsToZero:
      reconciliation.some((match) => match.type === "reversal_match") &&
      !summary.effects.some((effect) => effect.entryId === "reversed-fee") &&
      !summary.effects.some((effect) => effect.entryId === "fee-reversal"),
    netCashflowIs10150000: summary.netCashflowMinor === 10150000,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    reconciliation,
    summary,
  };
}
