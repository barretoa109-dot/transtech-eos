import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import type { ZeroEntryAutopilotResult } from "./zero-entry";
import type {
  FinancialAccount,
  FinancialConnectorSnapshot,
  FinancialObligation,
  LedgerEntry,
  ReconciliationMatch,
} from "./types";

export {
  sha256FinancialFingerprint,
  stableFinancialFingerprintMaterial,
} from "./persistence-fingerprint";

export interface FinancialConnectionUpsert {
  userId: string;
  providerKey: string;
  connectionKey: string;
  connectionType: "connector" | "csv_import" | "mock" | "other";
  country: string;
  status: "active" | "stale" | "degraded" | "revoked" | "disconnected" | "error";
  lastSyncAt: string;
  lastSuccessAt: string;
  freshUntil: string | null;
  health: "healthy" | "stale" | "degraded" | "error" | "unknown";
}

export interface FinancialAccountUpsert {
  userId: string;
  connectionKey: string;
  externalAccountId: string;
  accountType: FinancialAccount["type"];
  institutionName: string;
  displayName: string;
  currency: string;
  ownership: FinancialAccount["ownership"];
  availableBalanceMinor: number | null;
  ledgerBalanceMinor: number | null;
  balanceAsOf: string | null;
  freshUntil: string | null;
  status: "active" | "stale";
}

export interface FinancialIngestionEventUpsert {
  userId: string;
  providerKey: string;
  connectionKey: string;
  accountExternalId: string;
  sourceEventKey: string;
  externalEventId: string;
  eventType: "transaction_snapshot";
  providerStatus: LedgerEntry["status"];
  occurredAt: string;
  receivedAt: string;
  sourceFingerprint: string;
  payloadHash: string;
}

export interface FinancialLedgerUpsert {
  userId: string;
  providerKey: string;
  connectionKey: string;
  accountExternalId: string;
  sourceEventKey: string;
  canonicalKey: string;
  externalTransactionId: string | null;
  transactionType: LedgerEntry["type"];
  direction: LedgerEntry["direction"];
  status: LedgerEntry["status"];
  amountMinor: number;
  currency: string;
  occurredAt: string;
  postedAt: string | null;
  descriptionRaw: string;
  merchantNormalized: string | null;
  category: string | null;
  subcategory: string | null;
  counterpartyRef: string | null;
  recurrenceKey: string | null;
  reversalCanonicalKey: string | null;
  confidence: number;
  provenance: string;
}

export interface FinancialReconciliationInsert {
  userId: string;
  signature: string;
  reconciliationType: ReconciliationMatch["type"];
  ledgerCanonicalKeys: string[];
  decision: "accepted";
  confidence: number;
  matchedAmountMinor: number | null;
  reasonCode: string;
  ruleVersion: "financial-reconciliation-v1";
}

export interface FinancialRecurrenceUpsert {
  userId: string;
  recurrenceKey: string;
  kind: string;
  direction: "credit" | "debit";
  cadence: string;
  expectedAmountMinor: number;
  amountMinMinor: number;
  amountMaxMinor: number;
  currency: string;
  nextExpectedAt: string;
  essentiality: string;
  confidence: number;
  sourceLedgerCanonicalKeys: string[];
  status: "active";
}

export interface FinancialObligationUpsert {
  userId: string;
  sourceKey: string;
  recurrenceKey: string | null;
  obligationType: string;
  amountMinor: number;
  currency: string;
  dueAt: string;
  source: string;
  confidence: number;
  priority: number;
  mustProtect: boolean;
  status: "open";
}

export interface FinancialContextInsert {
  userId: string;
  revision: string;
  sourceFingerprint: string;
  currency: string;
  status: ZeroEntryAutopilotResult["context"]["available"]["status"];
  horizonUntil: string;
  horizonReason: ZeroEntryAutopilotResult["primaryHorizon"]["reason"];
  liquidityUsableMinor: number;
  protectedCommitmentsMinor: number;
  essentialSpendExpectedMinor: number;
  protectedReserveMinor: number;
  criticalProvisionsMinor: number;
  confirmedIncomeMinor: number;
  uncertaintyBufferMinor: number;
  availableRealSafeMinor: number;
  minimumProjectedCashMinor: number;
  minimumProjectedCashAt: string | null;
  confidence: ZeroEntryAutopilotResult["confidence"];
  explanationRefs: string[];
  sourcesFresh: boolean;
  generatedAt: string;
  validUntil: string;
}

export interface FinancialPersistencePlan {
  version: "financial-persistence-plan-v1";
  userId: string;
  providerKey: string;
  connectionUpserts: FinancialConnectionUpsert[];
  accountUpserts: FinancialAccountUpsert[];
  ingestionEventUpserts: FinancialIngestionEventUpsert[];
  ledgerUpserts: FinancialLedgerUpsert[];
  reconciliationInserts: FinancialReconciliationInsert[];
  recurrenceUpserts: FinancialRecurrenceUpsert[];
  obligationUpserts: FinancialObligationUpsert[];
  contextInsert: FinancialContextInsert;
}

export interface FinancialLedgerIdentity {
  providerKey: string;
  connectionKey: string;
  externalAccountId: string;
}

function normalizeString(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function accountMap(snapshot: FinancialConnectorSnapshot) {
  return new Map(snapshot.accounts.map((account) => [account.id, account]));
}

export function financialLedgerCanonicalKey(
  entry: LedgerEntry,
  identity: FinancialLedgerIdentity,
) {
  const scope = {
    providerKey: normalizeString(identity.providerKey),
    connectionKey: normalizeString(identity.connectionKey),
    externalAccountId: normalizeString(identity.externalAccountId),
  };

  if (entry.externalTransactionId) {
    return `ext:${sha256FinancialFingerprint({
      ...scope,
      externalTransactionId: normalizeString(entry.externalTransactionId),
    })}`;
  }

  if (entry.sourceEventId) {
    return `src:${sha256FinancialFingerprint({
      ...scope,
      sourceEventId: normalizeString(entry.sourceEventId),
    })}`;
  }

  return `fp:${sha256FinancialFingerprint({
    ...scope,
    occurredAt: entry.occurredAt,
    direction: entry.direction,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    descriptionRaw: normalizeString(entry.descriptionRaw).toLowerCase(),
  })}`;
}

function connectionType(providerKey: string): FinancialConnectionUpsert["connectionType"] {
  if (providerKey.startsWith("csv_")) return "csv_import";
  if (providerKey.startsWith("mock_")) return "mock";
  return "connector";
}

function connectionHealth(
  accounts: FinancialAccount[],
  asOf: string,
): Pick<FinancialConnectionUpsert, "status" | "health" | "freshUntil"> {
  const asOfMs = new Date(asOf).getTime();
  const freshTimes = accounts
    .map((account) => (account.freshUntil ? new Date(account.freshUntil).getTime() : Number.NaN))
    .filter(Number.isFinite);
  const earliestFresh = freshTimes.length > 0 ? Math.min(...freshTimes) : Number.NaN;
  const allFresh =
    accounts.length > 0 &&
    freshTimes.length === accounts.length &&
    Number.isFinite(earliestFresh) &&
    earliestFresh >= asOfMs;

  return {
    status: allFresh ? "active" : "stale",
    health: allFresh ? "healthy" : "stale",
    freshUntil: Number.isFinite(earliestFresh) ? new Date(earliestFresh).toISOString() : null,
  };
}

function sourceKeyForObligation(obligation: FinancialObligation) {
  return normalizeString(
    obligation.id || `${obligation.source}:${obligation.dueAt}:${obligation.amountMinor}`,
  );
}

function earliestIso(values: Array<string | null | undefined>, fallback: string) {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time)[0];
  return valid?.value ?? fallback;
}

function ledgerIdentity(
  snapshot: FinancialConnectorSnapshot,
  account: FinancialAccount,
): FinancialLedgerIdentity {
  return {
    providerKey: snapshot.providerKey,
    connectionKey: account.connectionId,
    externalAccountId: account.externalAccountId,
  };
}

export function buildFinancialPersistencePlan(input: {
  snapshot: FinancialConnectorSnapshot;
  result: ZeroEntryAutopilotResult;
}): FinancialPersistencePlan {
  const { snapshot, result } = input;
  const userIds = new Set([
    ...snapshot.accounts.map((account) => account.userId),
    ...snapshot.ledgerEntries.map((entry) => entry.userId),
  ]);
  if (userIds.size !== 1) throw new Error("financial persistence requires exactly one user");
  const userId = [...userIds][0];
  if (!userId) throw new Error("financial persistence requires a user");

  const accountsById = accountMap(snapshot);
  const canonicalByLedgerId = new Map(
    snapshot.ledgerEntries.map((entry) => {
      const account = accountsById.get(entry.accountId);
      if (!account) throw new Error(`ledger entry ${entry.id} references missing account`);
      return [entry.id, financialLedgerCanonicalKey(entry, ledgerIdentity(snapshot, account))];
    }),
  );

  const connectionGroups = new Map<string, FinancialAccount[]>();
  for (const account of snapshot.accounts) {
    const group = connectionGroups.get(account.connectionId) ?? [];
    group.push(account);
    connectionGroups.set(account.connectionId, group);
  }

  const connectionUpserts = [...connectionGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([connectionKey, accounts]) => {
      const health = connectionHealth(accounts, snapshot.fetchedAt);
      return {
        userId,
        providerKey: snapshot.providerKey,
        connectionKey,
        connectionType: connectionType(snapshot.providerKey),
        country: "PY",
        status: health.status,
        lastSyncAt: snapshot.fetchedAt,
        lastSuccessAt: snapshot.fetchedAt,
        freshUntil: health.freshUntil,
        health: health.health,
      } satisfies FinancialConnectionUpsert;
    });

  const accountUpserts = [...snapshot.accounts]
    .sort((a, b) => a.externalAccountId.localeCompare(b.externalAccountId))
    .map((account) => {
      const freshUntilMs = account.freshUntil ? new Date(account.freshUntil).getTime() : Number.NaN;
      const asOfMs = new Date(snapshot.fetchedAt).getTime();
      return {
        userId,
        connectionKey: account.connectionId,
        externalAccountId: account.externalAccountId,
        accountType: account.type,
        institutionName: account.institutionName,
        displayName: account.displayName,
        currency: account.currency,
        ownership: account.ownership,
        availableBalanceMinor: account.availableBalanceMinor,
        ledgerBalanceMinor: account.ledgerBalanceMinor,
        balanceAsOf: account.balanceAsOf,
        freshUntil: account.freshUntil,
        status:
          Number.isFinite(freshUntilMs) && freshUntilMs >= asOfMs ? "active" : "stale",
      } satisfies FinancialAccountUpsert;
    });

  const ingestionEventUpserts = [...snapshot.ledgerEntries]
    .sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId))
    .map((entry) => {
      const account = accountsById.get(entry.accountId);
      if (!account) throw new Error(`ledger entry ${entry.id} references missing account`);
      const sourceFingerprint = sha256FinancialFingerprint({
        providerKey: snapshot.providerKey,
        connectionKey: account.connectionId,
        accountExternalId: account.externalAccountId,
        sourceEventId: entry.sourceEventId,
        status: entry.status,
        externalTransactionId: entry.externalTransactionId,
        occurredAt: entry.occurredAt,
        postedAt: entry.postedAt,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        direction: entry.direction,
      });
      return {
        userId,
        providerKey: snapshot.providerKey,
        connectionKey: account.connectionId,
        accountExternalId: account.externalAccountId,
        sourceEventKey: entry.sourceEventId,
        externalEventId: entry.sourceEventId,
        eventType: "transaction_snapshot",
        providerStatus: entry.status,
        occurredAt: entry.occurredAt,
        receivedAt: snapshot.fetchedAt,
        sourceFingerprint,
        payloadHash: sha256FinancialFingerprint(entry),
      } satisfies FinancialIngestionEventUpsert;
    });

  const ledgerUpserts = [...snapshot.ledgerEntries]
    .map((entry) => {
      const account = accountsById.get(entry.accountId);
      if (!account) throw new Error(`ledger entry ${entry.id} references missing account`);
      return {
        userId,
        providerKey: snapshot.providerKey,
        connectionKey: account.connectionId,
        accountExternalId: account.externalAccountId,
        sourceEventKey: entry.sourceEventId,
        canonicalKey: financialLedgerCanonicalKey(entry, ledgerIdentity(snapshot, account)),
        externalTransactionId: entry.externalTransactionId,
        transactionType: entry.type,
        direction: entry.direction,
        status: entry.status,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        occurredAt: entry.occurredAt,
        postedAt: entry.postedAt,
        descriptionRaw: entry.descriptionRaw,
        merchantNormalized: entry.merchantNormalized,
        category: entry.category,
        subcategory: entry.subcategory,
        counterpartyRef: entry.counterpartyRef,
        recurrenceKey: entry.recurrenceId,
        reversalCanonicalKey: entry.reversalOf ? canonicalByLedgerId.get(entry.reversalOf) ?? null : null,
        confidence: entry.confidence,
        provenance: entry.provenance,
      } satisfies FinancialLedgerUpsert;
    })
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

  const reconciliationInserts = [...result.reconciliation]
    .map((match) => {
      const ledgerCanonicalKeys = match.entryIds
        .map((id) => canonicalByLedgerId.get(id))
        .filter((value): value is string => Boolean(value))
        .sort();
      if (ledgerCanonicalKeys.length !== match.entryIds.length) {
        throw new Error(`reconciliation ${match.reasonCode} references missing ledger evidence`);
      }
      const signature = sha256FinancialFingerprint({
        type: match.type,
        ledgerCanonicalKeys,
        reasonCode: match.reasonCode,
        matchedAmountMinor: match.matchedAmountMinor ?? null,
      });
      return {
        userId,
        signature,
        reconciliationType: match.type,
        ledgerCanonicalKeys,
        decision: "accepted",
        confidence: match.confidence,
        matchedAmountMinor: match.matchedAmountMinor ?? null,
        reasonCode: match.reasonCode,
        ruleVersion: "financial-reconciliation-v1",
      } satisfies FinancialReconciliationInsert;
    })
    .sort((a, b) => a.signature.localeCompare(b.signature));

  const recurrenceUpserts = [...result.patterns]
    .sort((a, b) => a.recurrenceKey.localeCompare(b.recurrenceKey))
    .map((pattern) => {
      const recurrence = result.recurrences.find((item) => item.key === pattern.recurrenceKey);
      if (!recurrence) throw new Error(`missing recurrence evidence for ${pattern.recurrenceKey}`);
      return {
        userId,
        recurrenceKey: pattern.recurrenceKey,
        kind: pattern.role,
        direction: pattern.direction,
        cadence: pattern.cadence,
        expectedAmountMinor: pattern.expectedAmountMinor,
        amountMinMinor: recurrence.amountMinMinor,
        amountMaxMinor: recurrence.amountMaxMinor,
        currency: pattern.currency,
        nextExpectedAt: pattern.nextExpectedAt,
        essentiality: pattern.essentiality,
        confidence: pattern.confidence,
        sourceLedgerCanonicalKeys: pattern.sourceEntryIds
          .map((id) => canonicalByLedgerId.get(id))
          .filter((value): value is string => Boolean(value))
          .sort(),
        status: "active",
      } satisfies FinancialRecurrenceUpsert;
    });

  const obligationUpserts = [...result.obligations]
    .sort((a, b) => sourceKeyForObligation(a).localeCompare(sourceKeyForObligation(b)))
    .map((obligation) => {
      const recurrenceKey = obligation.source.startsWith("inferred_recurrence:")
        ? obligation.source.slice("inferred_recurrence:".length)
        : null;
      return {
        userId,
        sourceKey: sourceKeyForObligation(obligation),
        recurrenceKey,
        obligationType: obligation.type,
        amountMinor: obligation.amountMinor,
        currency: obligation.currency,
        dueAt: obligation.dueAt,
        source: obligation.source,
        confidence: obligation.confidence,
        priority: obligation.priority,
        mustProtect: obligation.mustProtect,
        status: "open",
      } satisfies FinancialObligationUpsert;
    });

  const safetyInputs = result.resolvedInputs;
  const sourceFingerprint = sha256FinancialFingerprint({
    providerKey: snapshot.providerKey,
    accounts: accountUpserts,
    ledger: ledgerUpserts.map((entry) => ({
      canonicalKey: entry.canonicalKey,
      sourceEventKey: entry.sourceEventKey,
      status: entry.status,
      amountMinor: entry.amountMinor,
      occurredAt: entry.occurredAt,
      postedAt: entry.postedAt,
    })),
    reconciliations: reconciliationInserts.map((entry) => entry.signature),
    recurrences: recurrenceUpserts,
    obligations: obligationUpserts,
    safetyInputs,
    availableStatus: result.context.available.status,
    availableRealSafeMinor: result.context.available.availableRealSafeMinor,
  });

  const validUntil = earliestIso(
    [result.primaryHorizon.until, ...connectionUpserts.map((connection) => connection.freshUntil)],
    result.primaryHorizon.until,
  );

  const contextInsert: FinancialContextInsert = {
    userId,
    revision: `ctx:${sourceFingerprint}`,
    sourceFingerprint,
    currency: result.context.currency,
    status: result.context.available.status,
    horizonUntil: result.context.horizonUntil,
    horizonReason: result.primaryHorizon.reason,
    liquidityUsableMinor: result.context.liquidityUsableMinor,
    protectedCommitmentsMinor: result.context.protectedCommitmentsMinor,
    essentialSpendExpectedMinor: result.essentialSpend.expectedMinor,
    protectedReserveMinor: safetyInputs.protectedReserveMinor,
    criticalProvisionsMinor: safetyInputs.criticalProvisionsMinor,
    confirmedIncomeMinor: safetyInputs.confirmedIncomeMinor,
    uncertaintyBufferMinor: safetyInputs.uncertaintyBufferMinor,
    availableRealSafeMinor: result.context.available.availableRealSafeMinor,
    minimumProjectedCashMinor: result.context.minimumProjectedCashMinor,
    minimumProjectedCashAt: result.context.minimumProjectedCashAt,
    confidence: result.confidence,
    explanationRefs: [...result.context.explanationRefs].sort(),
    sourcesFresh: result.context.sourcesFresh,
    generatedAt: snapshot.fetchedAt,
    validUntil,
  };

  return {
    version: "financial-persistence-plan-v1",
    userId,
    providerKey: snapshot.providerKey,
    connectionUpserts,
    accountUpserts,
    ingestionEventUpserts,
    ledgerUpserts,
    reconciliationInserts,
    recurrenceUpserts,
    obligationUpserts,
    contextInsert,
  };
}

export interface FinancialPersistenceStore {
  persist(plan: FinancialPersistencePlan): Promise<{
    replayed: boolean;
    contextRevision: string;
    ledgerRowsTouched: number;
    ingestionRowsTouched: number;
    reconciliationRowsTouched: number;
  }>;
}
