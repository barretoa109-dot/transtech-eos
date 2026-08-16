import { NextResponse } from "next/server";
import {
  runBehaviorInferenceScenario,
  runCsvImportScenario,
  runEconomicSemanticsScenario,
  runFinancialStateScenario,
  runFinancialSurfaceScenario,
  runForecastHorizonScenario,
  runGlobalSourceCoverageScenario,
  runGlobalSourceCoverageTemporalScenario,
  runGlobalSourceOrchestrationScenario,
  runGlobalZeroEntryScenario,
  runLiquidityAuthorityScenario,
  runMultiProviderAnalysisScenario,
  runMultiProviderPersistenceManifestScenario,
  runMultiProviderScopedPersistenceScenario,
  runPyPilotScenario,
  runTrustedSourceCoverageScenario,
  runZeroEntryScenario,
} from "@/lib/financial-autopilot";
import {
  isFinancialStateDemoAllowed,
  runCriticalObligationsPersistenceScenario,
  runCriticalSourcesPersistenceScenario,
  runFinancialStateApiScenario,
  runFinancialStateResolverScenario,
  runFirstForecastRiskPersistenceScenario,
  runPersistenceRpcScenario,
  runPersistenceScenario,
  runSourceCoveragePersistenceBuilderScenario,
  runSupabaseFinancialStateReaderScenario,
  runSupabaseFinancialStateReaderV1_1Scenario,
  runSupabaseFinancialStateReaderV1_2Scenario,
  runSupabaseFinancialStateReaderV1_3Scenario,
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
  const liquidityAuthority = runLiquidityAuthorityScenario();
  const sourceCoverage = runTrustedSourceCoverageScenario();
  const globalSourceCoverage = runGlobalSourceCoverageScenario();
  const globalSourceCoverageTemporal =
    runGlobalSourceCoverageTemporalScenario();
  const multiProviderAnalysis = runMultiProviderAnalysisScenario();
  const globalSourceOrchestration = runGlobalSourceOrchestrationScenario();
  const zeroEntry = runZeroEntryScenario();
  const globalZeroEntry = runGlobalZeroEntryScenario();
  const multiProviderPersistenceManifest =
    runMultiProviderPersistenceManifestScenario();
  const multiProviderScopedPersistence =
    runMultiProviderScopedPersistenceScenario();
  const csvImport = runCsvImportScenario();
  const financialState = runFinancialStateScenario();
  const financialSurface = runFinancialSurfaceScenario();
  const persistence = await runPersistenceScenario();
  const persistenceRpc = await runPersistenceRpcScenario();
  const financialStateResolver = await runFinancialStateResolverScenario();
  const supabaseFinancialStateReader = await runSupabaseFinancialStateReaderScenario();
  const financialStateApi = runFinancialStateApiScenario();
  const firstForecastRiskPersistence = await runFirstForecastRiskPersistenceScenario();
  const criticalObligationsPersistence =
    await runCriticalObligationsPersistenceScenario();
  const criticalSourcesPersistence =
    await runCriticalSourcesPersistenceScenario();
  const sourceCoveragePersistenceBuilder =
    runSourceCoveragePersistenceBuilderScenario();
  const supabaseFinancialStateReaderV1_1 =
    await runSupabaseFinancialStateReaderV1_1Scenario();
  const supabaseFinancialStateReaderV1_2 =
    await runSupabaseFinancialStateReaderV1_2Scenario();
  const supabaseFinancialStateReaderV1_3 =
    await runSupabaseFinancialStateReaderV1_3Scenario();

  const checks = [
    compact("pilot", scenario),
    compact("economic-semantics", economicSemantics),
    compact("behavior-inference", behaviorInference),
    compact("forecast-horizons", forecastHorizons),
    compact("liquidity-authority", liquidityAuthority),
    compact("source-coverage", sourceCoverage),
    compact("global-source-coverage", globalSourceCoverage),
    compact("global-source-coverage-temporal", globalSourceCoverageTemporal),
    compact("multi-provider-analysis", multiProviderAnalysis),
    compact("global-source-orchestration", globalSourceOrchestration),
    compact("zero-entry", zeroEntry),
    compact("global-zero-entry", globalZeroEntry),
    compact("multi-provider-persistence-manifest", multiProviderPersistenceManifest),
    compact("multi-provider-scoped-persistence", multiProviderScopedPersistence),
    compact("csv-import", csvImport),
    compact("financial-state", financialState),
    compact("financial-surface", financialSurface),
    compact("persistence", persistence),
    compact("persistence-rpc", persistenceRpc),
    compact("financial-state-resolver", financialStateResolver),
    compact("supabase-financial-state-reader", supabaseFinancialStateReader),
    compact("financial-state-api", financialStateApi),
    compact("first-forecast-risk-persistence", firstForecastRiskPersistence),
    compact("critical-obligations-persistence", criticalObligationsPersistence),
    compact("critical-sources-persistence", criticalSourcesPersistence),
    compact("source-coverage-persistence-builder", sourceCoveragePersistenceBuilder),
    compact("supabase-financial-state-reader-v1-1", supabaseFinancialStateReaderV1_1),
    compact("supabase-financial-state-reader-v1-2", supabaseFinancialStateReaderV1_2),
    compact("supabase-financial-state-reader-v1-3", supabaseFinancialStateReaderV1_3),
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
