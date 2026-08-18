import type { FinancialImportCandidate } from "./csv-import";
import { classifyImportedTransaction } from "./transaction-classifier";
import type { FinancialAccount, FinancialConnectorSnapshot, LedgerEntry } from "./types";

export interface CsvAccountImportInput {
  importId: string;
  providerKey: string;
  userId: string;
  connectionId: string;
  accountId: string;
  externalAccountId: string;
  accountType: FinancialAccount["type"];
  institutionName: string;
  displayName: string;
  currency: string;
  ownership?: FinancialAccount["ownership"];
  availableBalanceMinor: number;
  ledgerBalanceMinor?: number;
  balanceAsOf: string;
  freshUntil: string;
  candidates: FinancialImportCandidate[];
}

export interface MaterializedCsvImport {
  account: FinancialAccount;
  ledgerEntries: LedgerEntry[];
}

export function materializeCsvAccountImport(
  input: CsvAccountImportInput,
): MaterializedCsvImport {
  if (!Number.isFinite(input.availableBalanceMinor)) {
    throw new Error("availableBalanceMinor must be finite");
  }

  const account: FinancialAccount = {
    id: input.accountId,
    userId: input.userId,
    externalAccountId: input.externalAccountId,
    connectionId: input.connectionId,
    type: input.accountType,
    institutionName: input.institutionName,
    displayName: input.displayName,
    currency: input.currency,
    ownership: input.ownership ?? "own",
    availableBalanceMinor: Math.trunc(input.availableBalanceMinor),
    ledgerBalanceMinor: Math.trunc(input.ledgerBalanceMinor ?? input.availableBalanceMinor),
    balanceAsOf: input.balanceAsOf,
    freshUntil: input.freshUntil,
  };

  const ledgerEntries = input.candidates.map((candidate): LedgerEntry => {
    if (candidate.currency !== input.currency) {
      throw new Error(
        `row ${candidate.rowNumber}: currency ${candidate.currency} does not match account ${input.currency}`,
      );
    }

    const classification = classifyImportedTransaction({
      direction: candidate.direction,
      descriptionRaw: candidate.descriptionRaw,
    });

    return {
      id: `csv:${input.importId}:row:${candidate.rowNumber}`,
      userId: input.userId,
      accountId: input.accountId,
      sourceEventId: `csv:${input.importId}:source:${candidate.rowNumber}`,
      externalTransactionId: candidate.externalId,
      type: classification.type,
      direction: candidate.direction,
      status: "posted",
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      occurredAt: candidate.occurredAt,
      postedAt: candidate.occurredAt,
      descriptionRaw: candidate.descriptionRaw,
      merchantNormalized: null,
      category: null,
      subcategory: null,
      counterpartyRef: null,
      internalTransferGroupId: null,
      recurrenceId: null,
      reversalOf: null,
      confidence: classification.confidence,
      provenance: `${input.providerKey}:csv_import:${classification.reasonCode}`,
    };
  });

  return { account, ledgerEntries };
}

export function combineCsvImports(
  providerKey: string,
  fetchedAt: string,
  imports: MaterializedCsvImport[],
): FinancialConnectorSnapshot {
  return {
    providerKey,
    fetchedAt,
    accounts: imports.map((item) => item.account),
    ledgerEntries: imports.flatMap((item) => item.ledgerEntries),
  };
}
