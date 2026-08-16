import { NextResponse } from "next/server";
import {
  runBehaviorInferenceScenario,
  runEconomicSemanticsScenario,
  runPyPilotScenario,
} from "@/lib/financial-autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scenario = runPyPilotScenario();
  const economicSemantics = runEconomicSemanticsScenario();
  const behaviorInference = runBehaviorInferenceScenario();
  const ok = scenario.ok && economicSemantics.ok && behaviorInference.ok;

  return NextResponse.json(
    {
      ok,
      scenario,
      economicSemantics,
      behaviorInference,
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
