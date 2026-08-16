import type {
  FinancialAccount,
  LedgerEntry,
  ReconciliationMatch,
} from "./types";

export type EconomicEffectKind =
  | "income"
  | "consumption"
  | "settlement"
  | "internal_transfer"
  | "refund"
  | "financing"
  | "investment_transfer"
  | "cash_location_change"
  | "adjustment"
  | "unknown";

export interface EconomicEffect {
  entryId: string;
  kind: EconomicEffectKind;
  cashflowMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  refundMinor: number;
  affectsConsumption: boolean;
  reasonCode: string;
}

export interface EconomicActivitySummary {
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
  refundMinor: number;
  netConsumptionMinor: number;
  netCashflowMinor: number;
  ignoredEntryIds: string[];
  effects: EconomicEffect[];
}

function signedCash(entry: LedgerEntry, account: FinancialAccount | undefined) {
  if (!account || account.type === "card" || account.type === "loan") return 0;
  if (entry.direction === "credit") return entry.amountMinor;
  if (entry.direction === "debit") return -entry.amountMinor;
  return 0;
}

export function classifyEconomicEffect(
  entry: LedgerEntry,
  accountsById: ReadonlyMap<string, FinancialAccount>,
): EconomicEffect {
  const account = accountsById.get(entry.accountId);
  const cashflowMinor = signedCash(entry, account);

  switch (entry.type) {
    case "income":
      return {
        entryId: entry.id,
        kind: "income",
        cashflowMinor,
        incomeMinor: entry.amountMinor,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode: "income_is_economic_inflow",
      };

    case "expense":
    case "fee":
    case "tax":
      return {
        entryId: entry.id,
        kind: "consumption",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: entry.amountMinor,
        refundMinor: 0,
        affectsConsumption: true,
        reasonCode:
          account?.type === "card"
            ? "card_purchase_is_expense_without_immediate_cash_outflow"
            : "posted_expense_is_consumption",
      };

    case "refund":
      return {
        entryId: entry.id,
        kind: "refund",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: entry.amountMinor,
        affectsConsumption: true,
        reasonCode: "refund_offsets_prior_consumption",
      };

    case "card_payment":
    case "debt_payment":
      return {
        entryId: entry.id,
        kind: "settlement",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode:
          entry.type === "card_payment"
            ? "card_payment_settles_liability_without_second_expense"
            : "debt_payment_is_financing_settlement_not_ordinary_consumption",
      };

    case "internal_transfer":
      return {
        entryId: entry.id,
        kind: "internal_transfer",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode: "own_account_transfer_has_no_economic_consumption",
      };

    case "debt_draw":
      return {
        entryId: entry.id,
        kind: "financing",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode: "borrowed_money_is_liquidity_not_income",
      };

    case "investment_contribution":
    case "investment_withdrawal":
      return {
        entryId: entry.id,
        kind: "investment_transfer",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode: "investment_flow_moves_assets_without_ordinary_consumption",
      };

    case "cash_withdrawal":
    case "cash_deposit":
      return {
        entryId: entry.id,
        kind: "cash_location_change",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode: "cash_movement_changes_location_not_consumption",
      };

    case "adjustment":
      return {
        entryId: entry.id,
        kind: "adjustment",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode: "adjustment_requires_explicit_economic_semantics",
      };

    default:
      return {
        entryId: entry.id,
        kind: "unknown",
        cashflowMinor,
        incomeMinor: 0,
        expenseMinor: 0,
        refundMinor: 0,
        affectsConsumption: false,
        reasonCode: "unknown_transaction_not_assumed_to_be_expense",
      };
  }
}

function ignoredLifecycleEntryIds(reconciliations: ReconciliationMatch[]) {
  const ignored = new Set<string>();
  for (const match of reconciliations) {
    if (match.type === "duplicate") {
      // Preserve the first observed record and suppress later replay copies.
      match.entryIds.slice(1).forEach((id) => ignored.add(id));
    }
    if (match.type === "pending_to_posted") {
      // Posted is the economic source of truth. Caller input may be unordered,
      // so pending entries are also filtered by status below.
      match.entryIds.forEach((id) => ignored.add(id));
    }
  }
  return ignored;
}

export function summarizeEconomicActivity(
  entries: LedgerEntry[],
  accounts: FinancialAccount[],
  currency: string,
  reconciliations: ReconciliationMatch[] = [],
): EconomicActivitySummary {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const ignored = ignoredLifecycleEntryIds(reconciliations);
  const effects: EconomicEffect[] = [];

  for (const entry of entries) {
    if (entry.currency !== currency) continue;
    if (entry.status !== "posted") continue;
    if (ignored.has(entry.id)) continue;
    effects.push(classifyEconomicEffect(entry, accountsById));
  }

  const incomeMinor = effects.reduce((sum, effect) => sum + effect.incomeMinor, 0);
  const expenseMinor = effects.reduce((sum, effect) => sum + effect.expenseMinor, 0);
  const refundMinor = effects.reduce((sum, effect) => sum + effect.refundMinor, 0);
  const netCashflowMinor = effects.reduce((sum, effect) => sum + effect.cashflowMinor, 0);

  return {
    currency,
    incomeMinor,
    expenseMinor,
    refundMinor,
    netConsumptionMinor: Math.max(0, expenseMinor - refundMinor),
    netCashflowMinor,
    ignoredEntryIds: [...ignored],
    effects,
  };
}
