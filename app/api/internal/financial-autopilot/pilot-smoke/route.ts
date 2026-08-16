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

type SmokeCheck = {
  ok: boolean;
};

function compact(name: string, result: SmokeCheck) {
  return { name, ok: result.ok };
}

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

  const checks = [
    compact("pilot", scenario),
    compact("economic-semantics", economicSemantics),
    compact("behavior-inference", behaviorInference),
    compact("forecast-horizons", forecastHorizons),
    compact("zero-entry", zeroEntry),
    compact("csv-import", csvImport),
    compact("financial-state", financialState),
    compact("financial-surface", financialSurface),
    compact("persistence", persistence),
    compact("persistence-rpc", persistenceRpc),
    compact("financial-state-resolver", financialStateResolver),
    compact("supabase-financial-state-reader", supabaseFinancialStateReader),
    compact("financial-state-api", financialStateApi),
    compact("first-forecast-risk-persistence", firstForecastRiskPersistence),
    compact("supabase-financial-state-reader-v1-1", supabaseFinancialStateReaderV1_1),
  ];

  const failed = checks.filter((check) => !check.ok).map((check) => check.name);
  const ok = failed.length === 0;

  return NextResponse.json(
    {
      ok,
      total: checks.length,
      passed: checks.length - failed.length,
      failed,
    },
    {
      status: ok ? 200 : 500,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
