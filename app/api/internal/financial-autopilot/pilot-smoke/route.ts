import { NextResponse } from "next/server";
import {
  runBehaviorInferenceScenario,
  runCsvImportScenario,
  runEconomicSemanticsScenario,
  runFinancialStateScenario,
  runForecastHorizonScenario,
  runPyPilotScenario,
  runZeroEntryScenario,
} from "@/lib/financial-autopilot";
import {
  runFinancialStateResolverScenario,
  runPersistenceRpcScenario,
  runPersistenceScenario,
} from "@/lib/financial-autopilot/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scenario = runPyPilotScenario();
  const economicSemantics = runEconomicSemanticsScenario();
  const behaviorInference = runBehaviorInferenceScenario();
  const forecastHorizons = runForecastHorizonScenario();
  const zeroEntry = runZeroEntryScenario();
  const csvImport = runCsvImportScenario();
  const financialState = runFinancialStateScenario();
  const persistence = await runPersistenceScenario();
  const persistenceRpc = await runPersistenceRpcScenario();
  const financialStateResolver = await runFinancialStateResolverScenario();
  const ok =
    scenario.ok &&
    economicSemantics.ok &&
    behaviorInference.ok &&
    forecastHorizons.ok &&
    zeroEntry.ok &&
    csvImport.ok &&
    financialState.ok &&
    persistence.ok &&
    persistenceRpc.ok &&
    financialStateResolver.ok;

  return NextResponse.json(
    {
      ok,
      scenario,
      economicSemantics,
      behaviorInference,
      forecastHorizons,
      zeroEntry,
      csvImport,
      financialState,
      persistence,
      persistenceRpc,
      financialStateResolver,
    },
    {
      status: ok ? 200 : 500,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
