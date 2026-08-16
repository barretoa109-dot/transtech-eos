import { NextResponse } from "next/server";
import { runFinancialStateScenario } from "@/lib/financial-autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scenario = runFinancialStateScenario();

  return NextResponse.json(
    {
      ok: scenario.ok,
      healthy: scenario.healthy,
      degraded: scenario.degraded,
      actionRequired: scenario.actionRequired,
    },
    {
      status: scenario.ok ? 200 : 500,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
