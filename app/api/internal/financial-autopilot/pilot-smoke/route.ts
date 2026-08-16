import { NextResponse } from "next/server";
import { runPyPilotScenario } from "@/lib/financial-autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scenario = runPyPilotScenario();
  return NextResponse.json(
    {
      ok: true,
      scenario,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
