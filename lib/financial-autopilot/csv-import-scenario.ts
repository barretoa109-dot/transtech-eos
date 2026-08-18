import { combineCsvImports, materializeCsvAccountImport } from "./csv-ledger";
import { parseFinancialCsv } from "./csv-import";
import { summarizeEconomicActivity } from "./economic-impact";
import { findDeterministicReconciliations } from "./reconciliation";

const USER_ID = "00000000-0000-4000-8000-000000000040";
const CONNECTION_ID = "10000000-0000-4000-8000-000000000040";
const CHECKING_ID = "20000000-0000-4000-8000-000000000040";
const SAVINGS_ID = "20000000-0000-4000-8000-000000000041";

export function runCsvImportScenario() {
  const checkingCsv = [
    "Fecha;Descripcion;Monto;Id",
    "01/08/2026 12:00:00;ACREDITACION HABERES EMPRESA DEMO;9000000;salary-aug",
    "16/08/2026 10:00:00;TRANSFERENCIA A CUENTA AHORRO;-1000000;transfer-out",
    "16/08/2026 11:00:00;SUPERMERCADO DEMO;-500000;grocery",
  ].join("\n");

  const savingsCsv = [
    "Fecha;Descripcion;Monto;Id",
    "16/08/2026 10:00:05;TRANSFERENCIA RECIBIDA CUENTA PRINCIPAL;1000000;transfer-in",
  ].join("\n");

  const mapping = {
    date: "Fecha",
    description: "Descripcion",
    amount: "Monto",
    externalId: "Id",
    defaultCurrency: "PYG",
    delimiter: ";" as const,
  };

  const checkingCandidates = parseFinancialCsv(checkingCsv, mapping);
  const savingsCandidates = parseFinancialCsv(savingsCsv, mapping);

  const checking = materializeCsvAccountImport({
    importId: "checking-aug-2026",
    providerKey: "csv_statement_v1",
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    accountId: CHECKING_ID,
    externalAccountId: "checking-demo",
    accountType: "checking",
    institutionName: "Banco Demo Paraguay",
    displayName: "Cuenta principal",
    currency: "PYG",
    availableBalanceMinor: 7500000,
    balanceAsOf: "2026-08-16T12:00:00.000Z",
    freshUntil: "2026-08-17T12:00:00.000Z",
    candidates: checkingCandidates,
  });

  const savings = materializeCsvAccountImport({
    importId: "savings-aug-2026",
    providerKey: "csv_statement_v1",
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    accountId: SAVINGS_ID,
    externalAccountId: "savings-demo",
    accountType: "savings",
    institutionName: "Banco Demo Paraguay",
    displayName: "Ahorro",
    currency: "PYG",
    availableBalanceMinor: 2500000,
    balanceAsOf: "2026-08-16T12:00:00.000Z",
    freshUntil: "2026-08-17T12:00:00.000Z",
    candidates: savingsCandidates,
  });

  const snapshot = combineCsvImports(
    "csv_statement_v1",
    "2026-08-16T12:00:00.000Z",
    [checking, savings],
  );
  const reconciliation = findDeterministicReconciliations(snapshot.ledgerEntries);
  const economics = summarizeEconomicActivity(
    snapshot.ledgerEntries,
    snapshot.accounts,
    "PYG",
    reconciliation,
  );

  const transferEffects = economics.effects.filter(
    (effect) => effect.kind === "internal_transfer",
  );

  const checks = {
    fourRowsImported: snapshot.ledgerEntries.length === 4,
    salaryAutoClassified:
      snapshot.ledgerEntries.find((entry) => entry.externalTransactionId === "salary-aug")?.type ===
      "income",
    ownTransferReconciled:
      reconciliation.filter((match) => match.type === "internal_transfer_match").length === 1,
    reconciliationOverridesDirectionalTransferClassification:
      transferEffects.length === 2 &&
      transferEffects.every(
        (effect) => effect.incomeMinor === 0 && effect.expenseMinor === 0,
      ),
    onlyRealConsumptionCounted: economics.netConsumptionMinor === 500000,
    onlySalaryCountedAsIncome: economics.incomeMinor === 9000000,
    crossAccountCashflowNetsTransfer: economics.netCashflowMinor === 8500000,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    snapshot,
    reconciliation,
    economics,
  };
}
