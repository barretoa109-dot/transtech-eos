import { buildFinancialContext } from "./context";
import { generateFinancialDecisionCandidates } from "./decision-candidates";
import { selectNextBestFinancialAction } from "./decision";
import { buildPyPilotSnapshot } from "./fixtures";
import { findDeterministicReconciliations } from "./reconciliation";
import { evaluateHypotheticalExpense } from "./what-if";
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

  const contextInput = {
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
    criticalSourcesComplete: true,
    criticalObligationsComplete: true,
    confidence: {
      sourceFreshness: 0.99,
      incomePredictability: 0.9,
      expensePredictability: 0.85,
      obligationCompleteness: 0.95,
      reconciliationQuality: 0.95,
      overall: 0.93,
    },
  } as const;

  const context = buildFinancialContext(contextInput);
  const reconciliation = findDeterministicReconciliations(snapshot.ledgerEntries);
  const healthyCandidates = generateFinancialDecisionCandidates({
    financialContext: context,
    protectedReserveMinor: contextInput.protectedReserveMinor,
  });
  const nextAction = selectNextBestFinancialAction(context.available.status, healthyCandidates);

  const safePurchase = evaluateHypotheticalExpense({
    openingCashMinor: context.liquidityUsableMinor,
    currentAvailableRealSafeMinor: context.available.availableRealSafeMinor,
    protectedReserveMinor: contextInput.protectedReserveMinor,
    forecastEvents,
    amountMinor: 300000,
    at: "2026-08-18T12:00:00.000Z",
    horizonUntil: contextInput.horizonUntil,
  });

  const unsafePurchase = evaluateHypotheticalExpense({
    openingCashMinor: context.liquidityUsableMinor,
    currentAvailableRealSafeMinor: context.available.availableRealSafeMinor,
    protectedReserveMinor: contextInput.protectedReserveMinor,
    forecastEvents,
    amountMinor: 8000000,
    at: "2026-08-18T12:00:00.000Z",
    horizonUntil: contextInput.horizonUntil,
  });

  const staleAccounts = snapshot.accounts.map((account) => ({
    ...account,
    freshUntil: "2026-08-15T00:00:00.000Z",
  }));
  const degradedContext = buildFinancialContext({
    ...contextInput,
    accounts: staleAccounts,
  });
  const degradedAction = selectNextBestFinancialAction(
    degradedContext.available.status,
    generateFinancialDecisionCandidates({
      financialContext: degradedContext,
      protectedReserveMinor: contextInput.protectedReserveMinor,
    }),
  );

  const incompleteSourcesContext = buildFinancialContext({
    ...contextInput,
    criticalSourcesComplete: false,
  });
  const incompleteSourcesAction = selectNextBestFinancialAction(
    incompleteSourcesContext.available.status,
    generateFinancialDecisionCandidates({
      financialContext: incompleteSourcesContext,
      protectedReserveMinor: contextInput.protectedReserveMinor,
    }),
  );

  const stressedAccounts = snapshot.accounts.map((account, index) => ({
    ...account,
    availableBalanceMinor: index === 0 ? 3000000 : 1000000,
    ledgerBalanceMinor: index === 0 ? 3000000 : 1000000,
  }));
  const actionRequiredContext = buildFinancialContext({
    ...contextInput,
    accounts: stressedAccounts,
  });
  const actionRequiredCandidates = generateFinancialDecisionCandidates({
    financialContext: actionRequiredContext,
    protectedReserveMinor: contextInput.protectedReserveMinor,
  });
  const actionRequiredDecision = selectNextBestFinancialAction(
    actionRequiredContext.available.status,
    actionRequiredCandidates,
  );

  const checks = {
    ownTransferReconciled:
      reconciliation.filter((match) => match.type === "internal_transfer_match").length === 1,
    liquidityIs16500000: context.liquidityUsableMinor === 16500000,
    protectedCommitmentsAre4500000: context.protectedCommitmentsMinor === 4500000,
    minimumProjectedCashIs10800000: context.minimumProjectedCashMinor === 10800000,
    availableRealSafeIs6900000: context.available.availableRealSafeMinor === 6900000,
    healthyStateIsSafe: context.available.status === "SAFE",
    healthyDecisionIsNoAction:
      healthyCandidates.length === 0 && nextAction.outcome === "NO_ACTION",
    safePurchaseAccepted: safePurchase.safe,
    unsafePurchaseBlocked:
      !unsafePurchase.safe && unsafePurchase.reasons.includes("crosses_protected_reserve"),
    staleSourcesDegrade:
      degradedContext.available.status === "DEGRADED" &&
      degradedAction.outcome === "CONNECTION_REQUIRED",
    freshButIncompleteSourceCoverageDegrades:
      incompleteSourcesContext.sourcesFresh === true &&
      incompleteSourcesContext.available.status === "DEGRADED" &&
      incompleteSourcesContext.available.degradedReasons.includes("critical_sources_incomplete") &&
      incompleteSourcesAction.outcome === "CONNECTION_REQUIRED",
    realConflictRequestsOneDecision:
      actionRequiredContext.available.status === "ACTION_REQUIRED" &&
      actionRequiredCandidates.length === 1 &&
      actionRequiredDecision.outcome === "USER_DECISION_REQUIRED",
  };

  return {
    ok: Object.values(checks).every(Boolean),
    providerKey: snapshot.providerKey,
    checks,
    reconciliation,
    context,
    whatIf: {
      safePurchase,
      unsafePurchase,
    },
    degradedContext,
    incompleteSourcesContext,
    actionRequiredContext,
    nextAction,
    degradedAction,
    incompleteSourcesAction,
    actionRequiredDecision,
  };
}
