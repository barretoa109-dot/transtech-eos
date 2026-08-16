import { buildZeroEntryFinancialAutopilot } from "./zero-entry";
import type { FinancialAccount, FinancialConnectorSnapshot, LedgerEntry } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000030";
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000030";
const CONNECTION_ID = "10000000-0000-4000-8000-000000000030";
const AS_OF = "2026-08-16T12:00:00.000Z";

function account(fresh = true): FinancialAccount {
  return {
    id: ACCOUNT_ID,
    userId: USER_ID,
    externalAccountId: "checking-zero-entry",
    connectionId: CONNECTION_ID,
    type: "checking",
    institutionName: "Banco Demo Paraguay",
    displayName: "Cuenta principal",
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 8000000,
    ledgerBalanceMinor: 8000000,
    balanceAsOf: AS_OF,
    freshUntil: fresh ? "2026-08-17T12:00:00.000Z" : "2026-08-15T12:00:00.000Z",
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
    provenance: "zero_entry_fixture",
  };
}

function history() {
  return [
    row("salary-may", "credit", 9000000, "2026-05-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-jun", "credit", 9000000, "2026-06-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-jul", "credit", 9000000, "2026-07-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),
    row("salary-aug", "credit", 9000000, "2026-08-01T12:00:00.000Z", "ACREDITACION HABERES EMPRESA DEMO", "income", "salary"),

    row("rent-may", "debit", 2100000, "2026-05-25T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-jun", "debit", 2100000, "2026-06-25T12:00:00.000Z", "ALQUILER CASA"),
    row("rent-jul", "debit", 2100000, "2026-07-25T12:00:00.000Z", "ALQUILER CASA"),

    row("utility-jun", "debit", 330000, "2026-06-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("utility-jul", "debit", 350000, "2026-07-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),
    row("utility-aug", "debit", 340000, "2026-08-10T12:00:00.000Z", "ANDE ELECTRICIDAD"),

    row("sub-jun", "debit", 89000, "2026-06-12T12:00:00.000Z", "NETFLIX SUBSCRIPTION"),
    row("sub-jul", "debit", 89000, "2026-07-12T12:00:00.000Z", "NETFLIX SUBSCRIPTION"),
    row("sub-aug", "debit", 89000, "2026-08-12T12:00:00.000Z", "NETFLIX SUBSCRIPTION"),

    row("grocery-a", "debit", 350000, "2026-06-28T18:00:00.000Z", "SUPERMERCADO ALFA", "food", "groceries"),
    row("grocery-b", "debit", 350000, "2026-07-05T18:00:00.000Z", "SUPERMERCADO BETA", "food", "groceries"),
    row("grocery-c", "debit", 350000, "2026-07-12T18:00:00.000Z", "SUPERMERCADO GAMMA", "food", "groceries"),
    row("grocery-d", "debit", 350000, "2026-07-19T18:00:00.000Z", "SUPERMERCADO DELTA", "food", "groceries"),
    row("grocery-e", "debit", 350000, "2026-07-26T18:00:00.000Z", "SUPERMERCADO EPSILON", "food", "groceries"),
    row("grocery-f", "debit", 350000, "2026-08-02T18:00:00.000Z", "SUPERMERCADO ZETA", "food", "groceries"),
    row("grocery-g", "debit", 350000, "2026-08-09T18:00:00.000Z", "SUPERMERCADO ETA", "food", "groceries"),
    row("grocery-h", "debit", 350000, "2026-08-16T10:00:00.000Z", "SUPERMERCADO THETA", "food", "groceries"),
  ];
}

function snapshot(fresh = true, includeSalary = true): FinancialConnectorSnapshot {
  const rows = history().filter((entry) => includeSalary || !entry.id.startsWith("salary-"));
  return {
    providerKey: "mock_zero_entry_py_v1",
    fetchedAt: AS_OF,
    accounts: [account(fresh)],
    ledgerEntries: rows,
  };
}

function run(
  snapshotValue: FinancialConnectorSnapshot,
  criticalObligationsComplete = true,
  criticalSourcesComplete = true,
) {
  return buildZeroEntryFinancialAutopilot({
    snapshot: snapshotValue,
    currency: "PYG",
    asOf: AS_OF,
    protectedReserveMinor: 3000000,
    criticalSourcesComplete,
    criticalObligationsComplete,
    criticalProvisionsMinor: 100000,
    baseUncertaintyBufferMinor: 120000,
  });
}

export function runZeroEntryScenario() {
  const healthy = run(snapshot());
  const stale = run(snapshot(false));
  const incompleteObligations = run(snapshot(true), false, true);
  const incompleteSources = run(snapshot(true), true, false);
  const variableIncome = run(snapshot(true, false));

  const checks = {
    nextSalaryDefinesPrimaryHorizon:
      healthy.primaryHorizon.reason === "next_high_confidence_income" &&
      healthy.primaryHorizon.until === "2026-09-01T12:00:00.000Z",
    salaryAtHorizonNotSpendableBeforeArrival:
      healthy.context.available.availableRealSafeMinor < healthy.context.liquidityUsableMinor &&
      healthy.context.available.availableRealSafeMinor <= 2000000,
    rentInferredBeforeSalary:
      healthy.obligations.some(
        (obligation) =>
          obligation.type === "housing" &&
          obligation.mustProtect &&
          new Date(obligation.dueAt).getTime() < new Date(healthy.primaryHorizon.until).getTime(),
      ),
    variableEssentialsInferredWithoutManualBudget:
      healthy.essentialSpend.expectedMinor === 800000 &&
      healthy.essentialSpend.sampleCount === 8,
    healthyIsSafeAndSilent:
      healthy.context.available.status === "SAFE" && healthy.nextAction.outcome === "NO_ACTION",
    staleConnectionNeverClaimsSafe:
      stale.context.available.status === "DEGRADED" &&
      stale.context.available.degradedReasons.includes("critical_source_stale") &&
      stale.nextAction.outcome === "CONNECTION_REQUIRED",
    incompleteObligationsNeverClaimsSafe:
      incompleteObligations.context.available.status === "DEGRADED" &&
      incompleteObligations.context.available.degradedReasons.includes("critical_obligations_incomplete") &&
      incompleteObligations.nextAction.outcome === "CONNECTION_REQUIRED",
    freshButIncompleteSourceCoverageNeverClaimsSafe:
      incompleteSources.context.sourcesFresh === true &&
      incompleteSources.confidence.sourceFreshness === healthy.confidence.sourceFreshness &&
      incompleteSources.context.available.status === "DEGRADED" &&
      incompleteSources.context.available.degradedReasons.includes("critical_sources_incomplete") &&
      incompleteSources.nextAction.outcome === "CONNECTION_REQUIRED",
    unpredictableIncomeUsesRollingHorizon:
      variableIncome.primaryHorizon.reason === "rolling_fallback" &&
      variableIncome.primaryHorizon.incomePatternRef === null,
    longForecastProduced: healthy.horizons.horizons.length === 3,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    staleStatus: stale.context.available,
    incompleteObligationsStatus: incompleteObligations.context.available,
    incompleteSourcesStatus: incompleteSources.context.available,
    variableIncomeHorizon: variableIncome.primaryHorizon,
  };
}
