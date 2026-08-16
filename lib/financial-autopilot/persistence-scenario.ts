import { buildFinancialPersistencePlan } from "./persistence";
import { buildZeroEntryFinancialAutopilot } from "./zero-entry";
import type { FinancialAccount, FinancialConnectorSnapshot, LedgerEntry } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000050";
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000050";
const CONNECTION_ID = "10000000-0000-4000-8000-000000000050";
const AS_OF = "2026-08-16T12:00:00.000Z";

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

function row(
  id: string,
  direction: "credit" | "debit",
  amountMinor: number,
  occurredAt: string,
  descriptionRaw: string,
  category: string | null = null,
  subcategory: string | null = null,
): LedgerEntry {
  return {
    id,
    userId: USER_ID,
    accountId: ACCOUNT_ID,
    sourceEventId: `event:${id}`,
    externalTransactionId: `external:${id}`,
    type: direction === "credit" ? "income" : "expense",
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
  ];
}

function snapshot(balanceMinor = 8000000, reverse = false): FinancialConnectorSnapshot {
  const entries = ledgerHistory();
  return {
    providerKey: "mock_persistence_py_v1",
    fetchedAt: AS_OF,
    accounts: [account(balanceMinor)],
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
    protectedReserveMinor: 3000000,
    criticalProvisionsMinor: 100000,
    baseUncertaintyBufferMinor: 120000,
  });
  return { result, plan };
}

export function runPersistenceScenario() {
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

  const checks = {
    exactReplayProducesSamePlan: JSON.stringify(first.plan) === JSON.stringify(replay.plan),
    inputOrderDoesNotChangePlan:
      JSON.stringify(first.plan) === JSON.stringify(reordered.plan),
    balanceChangeChangesContextFingerprint:
      first.plan.contextInsert.sourceFingerprint !== changedBalance.plan.contextInsert.sourceFingerprint,
    everyLedgerRowHasIngestionSource:
      first.plan.ledgerUpserts.every((entry) => ingestionKeys.has(entry.sourceEventKey)),
    ledgerCanonicalKeysUnique:
      new Set(ledgerCanonicalKeys).size === ledgerCanonicalKeys.length,
    obligationSourceKeysUnique:
      new Set(obligationKeys).size === obligationKeys.length,
    recurrenceEvidenceUsesCanonicalLedgerKeys:
      first.plan.recurrenceUpserts.every((recurrence) =>
        recurrence.sourceLedgerCanonicalKeys.every((key) => ledgerCanonicalKeys.includes(key)),
      ),
    contextCarriesResolvedSafetyInputs:
      first.plan.contextInsert.protectedReserveMinor === first.result.resolvedInputs.protectedReserveMinor &&
      first.plan.contextInsert.criticalProvisionsMinor === first.result.resolvedInputs.criticalProvisionsMinor &&
      first.plan.contextInsert.confirmedIncomeMinor === first.result.resolvedInputs.confirmedIncomeMinor &&
      first.plan.contextInsert.uncertaintyBufferMinor === first.result.resolvedInputs.uncertaintyBufferMinor,
    connectionPlanContainsNoCredentialMaterial:
      !/password|secret|token|credential/i.test(connectionPayload),
    healthyContextIsPersistable:
      first.result.context.available.status === "SAFE" &&
      first.plan.contextInsert.status === "SAFE" &&
      first.plan.contextInsert.availableRealSafeMinor > 0,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    counts: {
      connections: first.plan.connectionUpserts.length,
      accounts: first.plan.accountUpserts.length,
      ingestionEvents: first.plan.ingestionEventUpserts.length,
      ledgerRows: first.plan.ledgerUpserts.length,
      recurrences: first.plan.recurrenceUpserts.length,
      obligations: first.plan.obligationUpserts.length,
    },
    context: first.plan.contextInsert,
  };
}
