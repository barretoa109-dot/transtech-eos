export type FinancialStatus =
  | "SAFE"
  | "ATTENTION"
  | "ACTION_REQUIRED"
  | "DEGRADED";

export type TransactionType =
  | "income"
  | "expense"
  | "internal_transfer"
  | "card_payment"
  | "refund"
  | "debt_payment"
  | "debt_draw"
  | "investment_contribution"
  | "investment_withdrawal"
  | "fee"
  | "tax"
  | "cash_withdrawal"
  | "cash_deposit"
  | "adjustment"
  | "unknown";

export type TransactionDirection = "credit" | "debit" | "neutral";
export type TransactionStatus = "pending" | "posted" | "reversed" | "cancelled";

export interface FinancialAccount {
  id: string;
  userId: string;
  externalAccountId: string;
  connectionId: string;
  type:
    | "checking"
    | "savings"
    | "card"
    | "wallet"
    | "investment"
    | "loan"
    | "cash"
    | "other";
  institutionName: string;
  displayName: string;
  currency: string;
  ownership: "own" | "joint" | "external" | "unknown";
  availableBalanceMinor: number | null;
  ledgerBalanceMinor: number | null;
  balanceAsOf: string | null;
  freshUntil: string | null;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  accountId: string;
  sourceEventId: string;
  externalTransactionId: string | null;
  type: TransactionType;
  direction: TransactionDirection;
  status: TransactionStatus;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  postedAt: string | null;
  descriptionRaw: string;
  merchantNormalized: string | null;
  category: string | null;
  subcategory: string | null;
  counterpartyRef: string | null;
  internalTransferGroupId: string | null;
  recurrenceId: string | null;
  reversalOf: string | null;
  confidence: number;
  provenance: string;
}

export interface FinancialObligation {
  id: string;
  userId: string;
  type: string;
  amountMinor: number;
  currency: string;
  dueAt: string;
  priority: number;
  mustProtect: boolean;
  confidence: number;
  source: string;
}

export interface ForecastEvent {
  id: string;
  date: string;
  type: "income" | "expense" | "obligation" | "reserve" | "goal" | "other";
  amountMinor: number;
  direction: "credit" | "debit";
  /** Confidence in the source/interpretation. */
  confidence: number;
  /** Probability that the event occurs. Defaults to 1 when omitted. */
  probability?: number;
  essentiality: "critical" | "essential" | "flexible" | "optional";
  sourceRef: string;
}

export interface FinancialContextConfidence {
  sourceFreshness: number;
  incomePredictability: number;
  expensePredictability: number;
  obligationCompleteness: number;
  reconciliationQuality: number;
  overall: number;
}

export interface AvailableRealInput {
  currency: string;
  liquidityUsableMinor: number;
  protectedCommitmentsMinor: number;
  essentialSpendExpectedMinor: number;
  protectedReserveMinor: number;
  criticalProvisionsMinor: number;
  confirmedIncomeMinor: number;
  uncertaintyBufferMinor: number;
  minimumProjectedCashMinor: number;
  /** Whether every currently connected critical source is fresh enough. */
  sourcesFresh: boolean;
  /** Whether EOS knows the material source set is complete enough to claim safety. */
  criticalSourcesComplete: boolean;
  criticalObligationsComplete: boolean;
  confidence: FinancialContextConfidence;
  safeConfidenceThreshold?: number;
}

export interface AvailableRealResult {
  status: FinancialStatus;
  currency: string;
  availableRealRawMinor: number;
  availableRealSafeMinor: number;
  shortfallMinor: number;
  needsUserAction: boolean;
  degradedReasons: string[];
}

export interface ReconciliationMatch {
  type:
    | "duplicate"
    | "pending_to_posted"
    | "internal_transfer_match"
    | "card_payment_match"
    | "refund_match"
    | "reversal_match";
  entryIds: string[];
  confidence: number;
  reasonCode: string;
  matchedAmountMinor?: number;
}

export interface FinancialConnectorSnapshot {
  providerKey: string;
  fetchedAt: string;
  accounts: FinancialAccount[];
  ledgerEntries: LedgerEntry[];
}
