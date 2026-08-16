import { NextResponse } from "next/server";
import {
  runBehaviorInferenceScenario,
  runCsvImportScenario,
  runEconomicSemanticsScenario,
  runFinancialStateScenario,
  runFinancialSurfaceScenario,
  runForecastHorizonScenario,
  runPyPilotScenario,
  runZeroEntryScenario,
} from "@/lib/financial-autopilot";
import {
  isFinancialStateDemoAllowed,
  runFinancialStateApiScenario,
  runFinancialStateResolverScenario,
  runFirstForecastRiskPersistenceScenario,
  runPersistenceRpcScenario,
  runPersistenceScenario,
  runSupabaseFinancialStateReaderScenario,
  runSupabaseFinancialStateReaderV1_1Scenario,
} from "@/lib/financial-autopilot/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isFinancialStateDemoAllowed()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scenario = runPyPilotScenario();
  const economicSemantics = runEconomicSemanticsScenario();
  const behaviorInference = runBehaviorInferenceScenario();
  const forecastHorizons = runForecastHorizonScenario();
  const zeroEntry = runZeroEntryScenario();
  const csvImport = runCsvImportScenario();
  const financialState = runFinancialStateScenario();
  const financialSurface = runFinancialSurfaceScenario();
  const persistence = await runPersistenceScenario();
  const persistenceRpc = await runPersistenceRpcScenario();
  const financialStateResolver = await runFinancialStateResolverScenario();
  const supabaseFinancialStateReader = await runSupabaseFinancialStateReaderScenario();
  const financialStateApi = runFinancialStateApiScenario();
  const firstForecastRiskPersistence = await runFirstForecastRiskPersistenceScenario();
  const supabaseFinancialStateReaderV1_1 =
    await runSupabaseFinancialStateReaderV1_1Scenario();
  const ok =
    scenario.ok &&
    economicSemantics.ok &&
    behaviorInference.ok &&
    forecastHorizons.ok &&
    zeroEntry.ok &&
    csvImport.ok &&
    financialState.ok &&
    financialSurface.ok &&
    persistence.ok &&
    persistenceRpc.ok &&
    financialStateResolver.ok &&
    supabaseFinancialStateReader.ok &&
    financialStateApi.ok &&
    firstForecastRiskPersistence.ok &&
    supabaseFinancialStateReaderV1_1.ok;

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
      financialSurface,
      persistence,
      persistenceRpc,
      financialStateResolver,
      supabaseFinancialStateReader,
      financialStateApi,
      firstForecastRiskPersistence,
      supabaseFinancialStateReaderV1_1,
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
