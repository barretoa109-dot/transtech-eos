import { NextResponse } from "next/server";
import {
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
  const ok = scenario.ok && economicSemantics.ok;

  return NextResponse.json(
    {
      ok,
      scenario,
      economicSemantics,
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
