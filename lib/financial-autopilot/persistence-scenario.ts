import { InMemoryFinancialPersistenceStore } from "./memory-persistence-store";
import {
  buildFinancialPersistencePlan,
  financialLedgerCanonicalKey,
} from "./persistence";
import { buildZeroEntryFinancialAutopilot } from "./zero-entry";
import type { FinancialAccount, FinancialConnectorSnapshot, LedgerEntry } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000050";
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000050";
const SAVINGS_ACCOUNT_ID = "20000000-0000-4000-8000-000000000051";
const CONNECTION_ID = "10000000-0000-4000-8000-000000000050";
const AS_OF = "2026-08-16T12:00:00.000Z";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const COMPACT_LEDGER_KEY = /^(ext|src|fp):[a-f0-9]{64}$/;

function account(balanceMinor = 8000000): FinancialAccount {
  return {
    id: ACCOUNT_ID,
    userId: USER_ID,
    externalAccountId: "checking-persistence-demo",
    connectionId: CONNECTION_ID,
    type: "checking",
    institutionName: "Banco Demo Paraguay",
    displayName: "Cuenta principal",
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: balanceMinor,
    ledgerBalanceMinor: balanceMinor,
    balanceAsOf: AS_OF,
    freshUntil: "2026-08-17T12:00:00.000Z",
  };
}

function savingsAccount(): FinancialAccount {
  return {
    id: SAVINGS_ACCOUNT_ID,
    userId: USER_ID,
    externalAccountId: "savings-persistence-demo",
    connectionId: CONNECTION_ID,
    type: "savings",
    institutionName: "Banco Demo Paraguay",
    displayName: "Ahorro",
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 0,
    ledgerBalanceMinor: 0,
    balanceAsOf: AS_OF,
    freshUntil: "2026-08-17T12:00:00.000Z",
  };
}

function row(
  id: string,
  direction: "credit" | "debit",
  amountMinor: number,
  occurredAt: string,
  descriptionRaw: string,
  category: string | null = null,
  subcategory: string | null = null,
  accountId = ACCOUNT_ID,
  type: LedgerEntry["type"] = direction === "credit" ? "income" : "expense",
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
    descriptionRaw,
    merchantNormalized: null,
    category,
    subcategory,
    counterpartyRef: null,
    internalTransferGroupId: null,
    recurrenceId: null,
    reversalOf: null,
    confidence: 0.99,
    provenance: "persistence_fixture",
  };
}

function ledgerHistory() {
  return [
    row("salary-may", "credit", 9000000, "2026-05-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-jun", "credit", 9000000, "2026-06-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-jul", "credit", 9000000, "2026-07-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-aug", "credit", 9000000, "2026-08-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("rent-may", "debit", 2100000, "2026-05-25T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-jun", "debit", 2100000, "2026-06-25T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-jul", "debit", 2100000, "2026-07-25T12:00:00.000Z", "ALQUILER CASA"),
    row("grocery-a", "debit", 350000, "2026-07-19T18:00:00.000Z", "SUPERMERCADO A", "food", "groceries"),
    row("grocery-b", "debit", 350000, "2026-07-26T18:00:00.000Z", "SUPERMERCADO B", "food", "groceries"),
    row("grocery-c", "debit", 350000, "2026-08-02T18:00:00.000Z", "SUPERMERCADO C", "food", "groceries"),
    row("grocery-d", "debit", 350000, "2026-08-09T18:00:00.000Z", "SUPERMERCADO D", "food", "groceries"),
    row(
      "own-transfer-out",
      "debit",
      500000,
      "2026-08-14T10:00:00.000Z",
      "TRANSFERENCIA A AHORRO",
      null,
      null,
      ACCOUNT_ID,
      "unknown",
    ),
    row(
      "own-transfer-in",
      "credit",
      500000,
      "2026-08-14T10:00:05.000Z",
      "TRANSFERENCIA RECIBIDA DE CUENTA PRINCIPAL",
      null,
      null,
      SAVINGS_ACCOUNT_ID,
      "unknown",
    ),
  ];
}

function snapshot(balanceMinor = 8000000, reverse = false): FinancialConnectorSnapshot {
  const entries = ledgerHistory();
  return {
    providerKey: "mock_persistence_py_v1",
    fetchedAt: AS_OF,
    accounts: [account(balanceMinor), savingsAccount()],
    ledgerEntries: reverse ? [...entries].reverse() : entries,
  };
}

function run(snapshotValue: FinancialConnectorSnapshot) {
  const result = buildZeroEntryFinancialAutopilot({
    snapshot: snapshotValue,
    currency: "PYG",
    asOf: AS_OF,
    protectedReserveMinor: 3000000,
    criticalObligationsComplete: true,
    criticalProvisionsMinor: 100000,
    baseUncertaintyBufferMinor: 120000,
  });
  const plan = buildFinancialPersistencePlan({
    snapshot: snapshotValue,
    result,
  });
  return { result, plan };
}

export async function runPersistenceScenario() {
  const first = run(snapshot());
  const replay = run(snapshot());
  const reordered = run(snapshot(8000000, true));
  const changedBalance = run(snapshot(7500000));

  const ingestionKeys = new Set(
    first.plan.ingestionEventUpserts.map((event) => event.sourceEventKey),
  );
  const ledgerCanonicalKeys = first.plan.ledgerUpserts.map((entry) => entry.canonicalKey);
  const obligationKeys = first.plan.obligationUpserts.map((entry) => entry.sourceKey);
  const connectionPayload = JSON.stringify(first.plan.connectionUpserts);

  const store = new InMemoryFinancialPersistenceStore();
  const firstPersist = await store.persist(first.plan);
  const replayPersist = await store.persist(replay.plan);
  const changedPersist = await store.persist(changedBalance.plan);

  const tamperedPlan = JSON.parse(JSON.stringify(first.plan)) as typeof first.plan;
  tamperedPlan.contextInsert.sourceFingerprint = "tampered-context-fingerprint";
  tamperedPlan.contextInsert.revision = "ctx:tampered-context-fingerprint";
  tamperedPlan.ingestionEventUpserts[0] = {
    ...tamperedPlan.ingestionEventUpserts[0],
    sourceFingerprint: "tampered-ingestion-fingerprint",
  };
  let tamperedReplayBlocked = false;
  try {
    await store.persist(tamperedPlan);
  } catch (error) {
    tamperedReplayBlocked =
      error instanceof Error && error.message === "financial_ingestion_replay_mismatch";
  }

  const storedCounts = store.snapshotCounts();
  const internalTransfer = first.plan.reconciliationInserts.find(
    (match) => match.reconciliationType === "internal_transfer_match",
  );
  const transferOutKey = first.plan.ledgerUpserts.find(
    (entry) => entry.sourceEventKey === "event:own-transfer-out",
  )?.canonicalKey;
  const transferInKey = first.plan.ledgerUpserts.find(
    (entry) => entry.sourceEventKey === "event:own-transfer-in",
  )?.canonicalKey;

  const identityProbe = ledgerHistory()[0];
  const scopedKeyA = financialLedgerCanonicalKey(identityProbe, {
    providerKey: "provider-a",
    connectionKey: "connection-a",
    externalAccountId: "account-same",
  });
  const scopedKeyDifferentConnection = financialLedgerCanonicalKey(identityProbe, {
    providerKey: "provider-a",
    connectionKey: "connection-b",
    externalAccountId: "account-same",
  });
  const scopedKeyDifferentProvider = financialLedgerCanonicalKey(identityProbe, {
    providerKey: "provider-b",
    connectionKey: "connection-a",
    externalAccountId: "account-same",
  });

  const checks = {
    exactReplayProducesSamePlan: JSON.stringify(first.plan) === JSON.stringify(replay.plan),
    inputOrderDoesNotChangePlan:
      JSON.stringify(first.plan) === JSON.stringify(reordered.plan),
    compactSha256Fingerprints:
      SHA256_HEX.test(first.plan.contextInsert.sourceFingerprint) &&
      first.plan.contextInsert.revision === `ctx:${first.plan.contextInsert.sourceFingerprint}` &&
      first.plan.ingestionEventUpserts.every(
        (event) => SHA256_HEX.test(event.sourceFingerprint) && SHA256_HEX.test(event.payloadHash),
      ) &&
      first.plan.reconciliationInserts.every((reconciliation) =>
        SHA256_HEX.test(reconciliation.signature),
      ),
    compactScopedLedgerKeys:
      ledgerCanonicalKeys.every((key) => COMPACT_LEDGER_KEY.test(key)),
    ledgerIdentityIncludesProviderAndConnection:
      scopedKeyA !== scopedKeyDifferentConnection &&
      scopedKeyA !== scopedKeyDifferentProvider,
    sha256FingerprintStableAcrossInputOrder:
      first.plan.contextInsert.sourceFingerprint === reordered.plan.contextInsert.sourceFingerprint,
    balanceChangeChangesContextFingerprint:
      first.plan.contextInsert.sourceFingerprint !== changedBalance.plan.contextInsert.sourceFingerprint,
    everyLedgerRowHasIngestionSource:
      first.plan.ledgerUpserts.every((entry) => ingestionKeys.has(entry.sourceEventKey)),
    everyLedgerRowCarriesResolutionScope:
      first.plan.ledgerUpserts.every(
        (entry) =>
          entry.providerKey === first.plan.providerKey &&
          entry.connectionKey === CONNECTION_ID &&
          Boolean(entry.accountExternalId),
      ),
    externalEventIdentityUsesSourceEvent:
      first.plan.ingestionEventUpserts.every(
        (event) => event.externalEventId === event.sourceEventKey,
      ),
    ledgerCanonicalKeysUnique:
      new Set(ledgerCanonicalKeys).size === ledgerCanonicalKeys.length,
    obligationSourceKeysUnique:
      new Set(obligationKeys).size === obligationKeys.length,
    recurrenceEvidenceUsesCanonicalLedgerKeys:
      first.plan.recurrenceUpserts.every((recurrence) =>
        recurrence.sourceLedgerCanonicalKeys.every((key) => ledgerCanonicalKeys.includes(key)),
      ),
    reconciliationPlanMatchesEngine:
      first.plan.reconciliationInserts.length === first.result.reconciliation.length,
    ownTransferReconciliationPersisted:
      first.result.reconciliation.filter((match) => match.type === "internal_transfer_match").length === 1 &&
      Boolean(internalTransfer && transferOutKey && transferInKey) &&
      internalTransfer?.ledgerCanonicalKeys.length === 2 &&
      internalTransfer.ledgerCanonicalKeys.includes(transferOutKey ?? "") &&
      internalTransfer.ledgerCanonicalKeys.includes(transferInKey ?? ""),
    contextCarriesResolvedSafetyInputs:
      first.plan.contextInsert.protectedReserveMinor === first.result.resolvedInputs.protectedReserveMinor &&
      first.plan.contextInsert.criticalProvisionsMinor === first.result.resolvedInputs.criticalProvisionsMinor &&
      first.plan.contextInsert.confirmedIncomeMinor === first.result.resolvedInputs.confirmedIncomeMinor &&
      first.plan.contextInsert.uncertaintyBufferMinor === first.result.resolvedInputs.uncertaintyBufferMinor,
    contextValidityCannotOutliveFreshness:
      new Date(first.plan.contextInsert.validUntil).getTime() <=
      new Date(first.plan.connectionUpserts[0]?.freshUntil ?? first.plan.contextInsert.horizonUntil).getTime(),
    connectionPlanContainsNoCredentialMaterial:
      !/password|secret|token|credential/i.test(connectionPayload),
    healthyContextIsPersistable:
      first.result.context.available.status === "SAFE" &&
      first.plan.contextInsert.status === "SAFE" &&
      first.plan.contextInsert.availableRealSafeMinor > 0,
    firstPersistenceWritesCanonicalState:
      !firstPersist.replayed &&
      firstPersist.ingestionRowsTouched === first.plan.ingestionEventUpserts.length &&
      firstPersist.ledgerRowsTouched === first.plan.ledgerUpserts.length &&
      firstPersist.reconciliationRowsTouched === 1,
    exactReplayHasZeroEconomicWrites:
      replayPersist.replayed &&
      replayPersist.ingestionRowsTouched === 0 &&
      replayPersist.ledgerRowsTouched === 0 &&
      replayPersist.reconciliationRowsTouched === 0,
    contextOnlyChangeDoesNotDuplicateLedger:
      !changedPersist.replayed &&
      changedPersist.ingestionRowsTouched === 0 &&
      changedPersist.ledgerRowsTouched === 0 &&
      changedPersist.reconciliationRowsTouched === 0,
    ingestionReplayMismatchFailsClosed: tamperedReplayBlocked,
    failedReplayDidNotCreateContext: storedCounts.contexts === 2,
    canonicalLedgerCountRemainsStable:
      storedCounts.ledgerRows === first.plan.ledgerUpserts.length,
    reconciliationCountRemainsStable: storedCounts.reconciliations === 1,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    counts: {
      connections: first.plan.connectionUpserts.length,
      accounts: first.plan.accountUpserts.length,
      ingestionEvents: first.plan.ingestionEventUpserts.length,
      ledgerRows: first.plan.ledgerUpserts.length,
      reconciliations: first.plan.reconciliationInserts.length,
      recurrences: first.plan.recurrenceUpserts.length,
      obligations: first.plan.obligationUpserts.length,
    },
    identity: {
      contextFingerprint: first.plan.contextInsert.sourceFingerprint,
      contextRevision: first.plan.contextInsert.revision,
      reconciliationSignature: internalTransfer?.signature ?? null,
      ingestionSourceFingerprint: first.plan.ingestionEventUpserts[0]?.sourceFingerprint ?? null,
      ingestionPayloadHash: first.plan.ingestionEventUpserts[0]?.payloadHash ?? null,
      transferOutCanonicalKey: transferOutKey ?? null,
      transferInCanonicalKey: transferInKey ?? null,
    },
    reconciliation: internalTransfer ?? null,
    persistence: {
      firstPersist,
      replayPersist,
      changedPersist,
      storedCounts,
      tamperedReplayBlocked,
    },
    context: first.plan.contextInsert,
  };
}
