import { buildProviderPreservingFinancialAnalysisView } from "./multi-provider-analysis";
import type {
  FinancialAccount,
  FinancialConnectorSnapshot,
  LedgerEntry,
} from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000130";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000131";
const NOW = "2026-08-16T18:50:00.000Z";

function account(input: {
  id: string;
  externalAccountId: string;
  connectionId: string;
}): FinancialAccount {
  return {
    id: input.id,
    userId: USER_ID,
    externalAccountId: input.externalAccountId,
    connectionId: input.connectionId,
    type: "checking",
    institutionName: input.connectionId,
    displayName: input.externalAccountId,
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 5000000,
    ledgerBalanceMinor: 5000000,
    balanceAsOf: NOW,
    freshUntil: "2026-08-17T12:00:00.000Z",
  };
}

function entry(input: {
  id: string;
  accountId: string;
  sourceEventId: string;
  externalTransactionId: string;
}): LedgerEntry {
  return {
    id: input.id,
    userId: USER_ID,
    accountId: input.accountId,
    sourceEventId: input.sourceEventId,
    externalTransactionId: input.externalTransactionId,
    type: "expense",
    direction: "debit",
    status: "posted",
    amountMinor: 100000,
    currency: "PYG",
    occurredAt: NOW,
    postedAt: NOW,
    descriptionRaw: input.id,
    merchantNormalized: null,
    category: "other",
    subcategory: null,
    counterpartyRef: null,
    internalTransferGroupId: null,
    recurrenceId: null,
    reversalOf: null,
    confidence: 0.99,
    provenance: "multi_provider_fixture",
  };
}

function snapshot(
  providerKey: string,
  accountValue: FinancialAccount,
  entryValue: LedgerEntry,
  fetchedAt = NOW,
): FinancialConnectorSnapshot {
  return {
    providerKey,
    fetchedAt,
    accounts: [accountValue],
    ledgerEntries: [entryValue],
  };
}

function catchesCode(work: () => unknown, code: string) {
  try {
    work();
    return false;
  } catch (error) {
    return error instanceof Error && error.message === code;
  }
}

export function runMultiProviderAnalysisScenario() {
  const accountA = account({
    id: "20000000-0000-4000-8000-000000000130",
    externalAccountId: "checking-a",
    connectionId: "connection-a",
  });
  const accountB = account({
    id: "20000000-0000-4000-8000-000000000131",
    externalAccountId: "checking-b",
    connectionId: "connection-b",
  });
  const snapshotA = snapshot(
    "provider-a",
    accountA,
    entry({
      id: "30000000-0000-4000-8000-000000000130",
      accountId: accountA.id,
      sourceEventId: "event-a",
      externalTransactionId: "tx-a",
    }),
    "2026-08-16T18:45:00.000Z",
  );
  const snapshotB = snapshot(
    "provider-b",
    accountB,
    entry({
      id: "30000000-0000-4000-8000-000000000131",
      accountId: accountB.id,
      sourceEventId: "event-b",
      externalTransactionId: "tx-b",
    }),
    NOW,
  );

  const healthy = buildProviderPreservingFinancialAnalysisView({
    trustedUserId: USER_ID,
    snapshots: [snapshotA, snapshotB],
    nowIso: NOW,
  });
  const reordered = buildProviderPreservingFinancialAnalysisView({
    trustedUserId: USER_ID,
    snapshots: [snapshotB, snapshotA],
    nowIso: NOW,
  });

  const duplicateAccountIdBlocked = catchesCode(
    () =>
      buildProviderPreservingFinancialAnalysisView({
        trustedUserId: USER_ID,
        snapshots: [
          snapshotA,
          {
            ...snapshotB,
            accounts: [{ ...accountB, id: accountA.id }],
            ledgerEntries: [
              {
                ...snapshotB.ledgerEntries[0],
                accountId: accountA.id,
              },
            ],
          },
        ],
        nowIso: NOW,
      }),
    "financial_multi_provider_duplicate_account_id",
  );

  const duplicateLedgerIdBlocked = catchesCode(
    () =>
      buildProviderPreservingFinancialAnalysisView({
        trustedUserId: USER_ID,
        snapshots: [
          snapshotA,
          {
            ...snapshotB,
            ledgerEntries: [
              { ...snapshotB.ledgerEntries[0], id: snapshotA.ledgerEntries[0].id },
            ],
          },
        ],
        nowIso: NOW,
      }),
    "financial_multi_provider_duplicate_ledger_id",
  );

  const wrongAccountScopeBlocked = catchesCode(
    () =>
      buildProviderPreservingFinancialAnalysisView({
        trustedUserId: USER_ID,
        snapshots: [
          {
            ...snapshotB,
            ledgerEntries: [
              { ...snapshotB.ledgerEntries[0], accountId: accountA.id },
            ],
          },
        ],
        nowIso: NOW,
      }),
    "financial_multi_provider_ledger_account_scope_mismatch",
  );

  const duplicateSourceAccount = account({
    id: "20000000-0000-4000-8000-000000000132",
    externalAccountId: accountA.externalAccountId,
    connectionId: accountA.connectionId,
  });
  const duplicateAccountSourceBlocked = catchesCode(
    () =>
      buildProviderPreservingFinancialAnalysisView({
        trustedUserId: USER_ID,
        snapshots: [
          snapshotA,
          snapshot(
            "provider-a",
            duplicateSourceAccount,
            entry({
              id: "30000000-0000-4000-8000-000000000132",
              accountId: duplicateSourceAccount.id,
              sourceEventId: "event-duplicate-account-source",
              externalTransactionId: "tx-duplicate-account-source",
            }),
          ),
        ],
        nowIso: NOW,
      }),
    "financial_multi_provider_duplicate_account_source",
  );

  const duplicateLedgerSourceBlocked = catchesCode(
    () =>
      buildProviderPreservingFinancialAnalysisView({
        trustedUserId: USER_ID,
        snapshots: [
          snapshotA,
          {
            ...snapshotA,
            accounts: [
              { ...accountA, id: "20000000-0000-4000-8000-000000000133" },
            ],
            ledgerEntries: [
              {
                ...snapshotA.ledgerEntries[0],
                id: "30000000-0000-4000-8000-000000000133",
                accountId: "20000000-0000-4000-8000-000000000133",
              },
            ],
          },
        ],
        nowIso: NOW,
      }),
    "financial_multi_provider_duplicate_account_source",
  );

  const crossUserBlocked = catchesCode(
    () =>
      buildProviderPreservingFinancialAnalysisView({
        trustedUserId: USER_ID,
        snapshots: [
          {
            ...snapshotA,
            accounts: [{ ...accountA, userId: OTHER_USER_ID }],
          },
        ],
        nowIso: NOW,
      }),
    "financial_multi_provider_account_owner_mismatch",
  );

  const futureSnapshotBlocked = catchesCode(
    () =>
      buildProviderPreservingFinancialAnalysisView({
        trustedUserId: USER_ID,
        snapshots: [
          { ...snapshotA, fetchedAt: "2026-08-16T18:55:00.001Z" },
        ],
        nowIso: NOW,
      }),
    "financial_multi_provider_invalid_fetched_at",
  );

  const checks = {
    providerOriginsArePreserved:
      healthy.providerScopes.length === 2 &&
      healthy.accountOrigins.some(
        (origin) =>
          origin.accountId === accountA.id && origin.providerKey === "provider-a",
      ) &&
      healthy.accountOrigins.some(
        (origin) =>
          origin.accountId === accountB.id && origin.providerKey === "provider-b",
      ) &&
      healthy.ledgerOrigins.every((origin) => Boolean(origin.providerKey)),
    analysisContainsBothProvidersWithoutSyntheticProvider:
      healthy.accounts.length === 2 &&
      healthy.ledgerEntries.length === 2 &&
      healthy.providerScopes.every(
        (scope) => scope.providerKey === "provider-a" || scope.providerKey === "provider-b",
      ),
    aggregationIsOrderIndependent:
      healthy.analysisFingerprint === reordered.analysisFingerprint &&
      JSON.stringify(healthy.providerScopes) === JSON.stringify(reordered.providerScopes) &&
      JSON.stringify(healthy.accountOrigins) === JSON.stringify(reordered.accountOrigins) &&
      JSON.stringify(healthy.ledgerOrigins) === JSON.stringify(reordered.ledgerOrigins),
    fetchedWindowIsExplicit:
      healthy.oldestFetchedAt === "2026-08-16T18:45:00.000Z" &&
      healthy.newestFetchedAt === NOW,
    duplicateAccountIdFailsClosed: duplicateAccountIdBlocked,
    duplicateLedgerIdFailsClosed: duplicateLedgerIdBlocked,
    ledgerCannotJumpProviderAccountScope: wrongAccountScopeBlocked,
    duplicateProviderScopedAccountFailsClosed: duplicateAccountSourceBlocked,
    overlappingProviderSnapshotFailsBeforeDoubleCounting: duplicateLedgerSourceBlocked,
    crossUserAccountFailsAtSecurityBoundary: crossUserBlocked,
    futureSnapshotBeyondSkewFailsClosed: futureSnapshotBlocked,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
  };
}
