import { buildFinancialContext } from "./context";
import { buildPyPilotSnapshot } from "./fixtures";
import { findDeterministicReconciliations } from "./reconciliation";
import { selectNextBestFinancialAction } from "./decision";
import type { FinancialObligation, ForecastEvent } from "./types";

export function runPyPilotScenario() {
  const snapshot = buildPyPilotSnapshot();
  const userId = snapshot.accounts[0]?.userId;
  if (!userId) throw new Error("pilot snapshot missing user");

  const obligations: FinancialObligation[] = [
    {
      id: "40000000-0000-4000-8000-000000000001",
      userId,
      type: "rent",
      amountMinor: 2100000,
      currency: "PYG",
      dueAt: "2026-08-20T12:00:00.000Z",
      priority: 100,
      mustProtect: true,
      confidence: 0.99,
      source: "pilot_fixture",
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      userId,
      type: "card_balance",
      amountMinor: 2400000,
      currency: "PYG",
      dueAt: "2026-08-25T12:00:00.000Z",
      priority: 100,
      mustProtect: true,
      confidence: 0.99,
      source: "pilot_fixture",
    },
  ];

  const forecastEvents: ForecastEvent[] = [
    {
      id: "forecast-rent",
      date: "2026-08-20T12:00:00.000Z",
      type: "obligation",
      amountMinor: 2100000,
      direction: "debit",
      confidence: 0.99,
      probability: 1,
      essentiality: "critical",
      sourceRef: "obligation:rent",
    },
    {
      id: "forecast-card",
      date: "2026-08-25T12:00:00.000Z",
      type: "obligation",
      amountMinor: 2400000,
      direction: "debit",
      confidence: 0.99,
      probability: 1,
      essentiality: "critical",
      sourceRef: "obligation:card",
    },
    {
      id: "forecast-essentials",
      date: "2026-08-30T12:00:00.000Z",
      type: "expense",
      amountMinor: 1200000,
      direction: "debit",
      confidence: 0.9,
      probability: 1,
      essentiality: "essential",
      sourceRef: "behavioral:essential-spend",
    },
  ];

  const context = buildFinancialContext({
    currency: "PYG",
    asOf: "2026-08-16T01:00:00.000Z",
    horizonUntil: "2026-08-31T23:59:59.000Z",
    accounts: snapshot.accounts,
    obligations,
    forecastEvents,
    essentialSpendExpectedMinor: 1200000,
    protectedReserveMinor: 3000000,
    criticalProvisionsMinor: 500000,
    confirmedIncomeMinor: 0,
    uncertaintyBufferMinor: 400000,
    criticalObligationsComplete: true,
    confidence: {
      sourceFreshness: 0.99,
      incomePredictability: 0.9,
      expensePredictability: 0.85,
      obligationCompleteness: 0.95,
      reconciliationQuality: 0.95,
      overall: 0.93,
    },
  });

  const reconciliation = findDeterministicReconciliations(snapshot.ledgerEntries);
  const nextAction = selectNextBestFinancialAction(context.available.status, []);

  return {
    providerKey: snapshot.providerKey,
    reconciliation,
    context,
    nextAction,
  };
}
