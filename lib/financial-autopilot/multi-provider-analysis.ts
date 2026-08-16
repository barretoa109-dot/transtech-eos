import { sha256FinancialFingerprint } from "./persistence-fingerprint";
import { financialAccountSourceCoverageRef } from "./source-coverage";
import type {
  FinancialAccount,
  FinancialConnectorSnapshot,
  LedgerEntry,
} from "./types";

export interface ProviderAnalysisScope {
  providerKey: string;
  fetchedAt: string;
  accountIds: string[];
  ledgerEntryIds: string[];
}

export interface ProviderAccountOrigin {
  accountId: string;
  providerKey: string;
  sourceRef: string;
}

export interface ProviderLedgerOrigin {
  ledgerEntryId: string;
  accountId: string;
  providerKey: string;
  sourceIdentity: string;
}

export interface ProviderPreservingFinancialAnalysisView {
  version: "provider-preserving-financial-analysis-v1";
  trustedUserId: string;
  oldestFetchedAt: string;
  newestFetchedAt: string;
  accounts: FinancialAccount[];
  ledgerEntries: LedgerEntry[];
  providerScopes: ProviderAnalysisScope[];
  accountOrigins: ProviderAccountOrigin[];
  ledgerOrigins: ProviderLedgerOrigin[];
  /** Internal compact commitment to exact provider-scoped analysis material. */
  analysisFingerprint: string;
}

function parseTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function normalizeProviderKey(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new Error("financial_multi_provider_invalid_provider_key");
  }
  return normalized;
}

function providerLedgerSourceIdentity(input: {
  providerKey: string;
  account: FinancialAccount;
  entry: LedgerEntry;
}) {
  return sha256FinancialFingerprint({
    contract: "provider-ledger-source-identity-v1",
    providerKey: input.providerKey,
    connectionId: input.account.connectionId,
    externalAccountId: input.account.externalAccountId,
    externalTransactionId: input.entry.externalTransactionId,
    sourceEventId: input.entry.sourceEventId,
  });
}

/**
 * Builds an analysis-only multi-provider view without inventing a synthetic
 * provider. Every account/ledger row keeps an explicit provider origin so later
 * persistence can remain provider + connection scoped.
 */
export function buildProviderPreservingFinancialAnalysisView(input: {
  trustedUserId: string;
  snapshots: FinancialConnectorSnapshot[];
  nowIso: string;
}): ProviderPreservingFinancialAnalysisView {
  if (!input.trustedUserId) {
    throw new Error("financial_multi_provider_missing_trusted_user");
  }
  if (input.snapshots.length === 0) {
    throw new Error("financial_multi_provider_requires_snapshot");
  }

  const now = parseTime(input.nowIso);
  if (now === null) {
    throw new Error("financial_multi_provider_invalid_now");
  }

  const accountIds = new Set<string>();
  const ledgerIds = new Set<string>();
  const accountSourceRefs = new Set<string>();
  const ledgerSourceIdentities = new Set<string>();
  const accountRows: Array<{
    account: FinancialAccount;
    providerKey: string;
    sourceRef: string;
  }> = [];
  const ledgerRows: Array<{
    entry: LedgerEntry;
    providerKey: string;
    sourceIdentity: string;
  }> = [];
  const scopes: ProviderAnalysisScope[] = [];
  const fetchedTimes: number[] = [];

  for (const snapshot of input.snapshots) {
    const providerKey = normalizeProviderKey(snapshot.providerKey);
    const fetchedAt = parseTime(snapshot.fetchedAt);
    if (fetchedAt === null || fetchedAt > now + 5 * 60 * 1000) {
      throw new Error("financial_multi_provider_invalid_fetched_at");
    }
    fetchedTimes.push(fetchedAt);

    const localAccounts = new Map<string, FinancialAccount>();
    for (const account of snapshot.accounts) {
      if (account.userId !== input.trustedUserId) {
        throw new Error("financial_multi_provider_account_owner_mismatch");
      }
      if (!account.id || localAccounts.has(account.id) || accountIds.has(account.id)) {
        throw new Error("financial_multi_provider_duplicate_account_id");
      }
      localAccounts.set(account.id, account);
      accountIds.add(account.id);

      const sourceRef = financialAccountSourceCoverageRef({
        userId: input.trustedUserId,
        providerKey,
        account,
      });
      if (accountSourceRefs.has(sourceRef)) {
        throw new Error("financial_multi_provider_duplicate_account_source");
      }
      accountSourceRefs.add(sourceRef);
      accountRows.push({ account, providerKey, sourceRef });
    }

    for (const entry of snapshot.ledgerEntries) {
      if (entry.userId !== input.trustedUserId) {
        throw new Error("financial_multi_provider_ledger_owner_mismatch");
      }
      if (!entry.id || ledgerIds.has(entry.id)) {
        throw new Error("financial_multi_provider_duplicate_ledger_id");
      }
      const account = localAccounts.get(entry.accountId);
      if (!account) {
        throw new Error("financial_multi_provider_ledger_account_scope_mismatch");
      }
      ledgerIds.add(entry.id);

      const sourceIdentity = providerLedgerSourceIdentity({
        providerKey,
        account,
        entry,
      });
      if (ledgerSourceIdentities.has(sourceIdentity)) {
        throw new Error("financial_multi_provider_duplicate_ledger_source");
      }
      ledgerSourceIdentities.add(sourceIdentity);
      ledgerRows.push({ entry, providerKey, sourceIdentity });
    }

    scopes.push({
      providerKey,
      fetchedAt: new Date(fetchedAt).toISOString(),
      accountIds: [...localAccounts.keys()].sort(),
      ledgerEntryIds: snapshot.ledgerEntries.map((entry) => entry.id).sort(),
    });
  }

  accountRows.sort((a, b) =>
    `${a.providerKey}:${a.sourceRef}:${a.account.id}`.localeCompare(
      `${b.providerKey}:${b.sourceRef}:${b.account.id}`,
    ),
  );
  ledgerRows.sort((a, b) =>
    `${a.providerKey}:${a.sourceIdentity}:${a.entry.id}`.localeCompare(
      `${b.providerKey}:${b.sourceIdentity}:${b.entry.id}`,
    ),
  );
  scopes.sort((a, b) =>
    `${a.providerKey}:${a.fetchedAt}:${a.accountIds.join(",")}`.localeCompare(
      `${b.providerKey}:${b.fetchedAt}:${b.accountIds.join(",")}`,
    ),
  );

  const oldestFetchedAt = new Date(Math.min(...fetchedTimes)).toISOString();
  const newestFetchedAt = new Date(Math.max(...fetchedTimes)).toISOString();
  const accountOrigins = accountRows.map((row) => ({
    accountId: row.account.id,
    providerKey: row.providerKey,
    sourceRef: row.sourceRef,
  }));
  const ledgerOrigins = ledgerRows.map((row) => ({
    ledgerEntryId: row.entry.id,
    accountId: row.entry.accountId,
    providerKey: row.providerKey,
    sourceIdentity: row.sourceIdentity,
  }));

  const analysisFingerprint = sha256FinancialFingerprint({
    contract: "provider-preserving-financial-analysis-v1",
    trustedUserId: input.trustedUserId,
    scopes,
    accounts: accountRows.map((row) => ({
      providerKey: row.providerKey,
      sourceRef: row.sourceRef,
      account: row.account,
    })),
    ledger: ledgerRows.map((row) => ({
      providerKey: row.providerKey,
      sourceIdentity: row.sourceIdentity,
      entry: row.entry,
    })),
  });

  return {
    version: "provider-preserving-financial-analysis-v1",
    trustedUserId: input.trustedUserId,
    oldestFetchedAt,
    newestFetchedAt,
    accounts: accountRows.map((row) => row.account),
    ledgerEntries: ledgerRows.map((row) => row.entry),
    providerScopes: scopes,
    accountOrigins,
    ledgerOrigins,
    analysisFingerprint,
  };
}
