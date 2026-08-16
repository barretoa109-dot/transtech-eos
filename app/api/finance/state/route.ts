import { NextResponse } from "next/server";
import {
  classifyFinancialStateReadFailure,
  financialStateApiHeaders,
  isFinancialStateApiEnabled,
  isFinancialStateV1_2Enabled,
} from "@/lib/financial-autopilot/financial-state-api-policy";
import {
  resolveFinancialState,
  SupabaseFinancialStateReaderV1_1,
  SupabaseFinancialStateReaderV1_2,
} from "@/lib/financial-autopilot/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = financialStateApiHeaders();

  // Server-only kill switch. The route exists in code but stays dark until the
  // finance-v1 + first-forecast-risk v1.1 schema has been validated outside
  // production and explicitly enabled.
  if (!isFinancialStateApiEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Sesión no válida." },
        { status: 401, headers },
      );
    }

    // v1.2 is a second exact-true, server-only rollout gate. It must remain off
    // until its schema/RPC draft has passed non-production Postgres validation.
    // If enabled without the required column, the v1.2 reader fails closed and
    // this route returns 503 rather than falling back to a less strict reader.
    const reader = isFinancialStateV1_2Enabled()
      ? new SupabaseFinancialStateReaderV1_2(supabase, user.id)
      : new SupabaseFinancialStateReaderV1_1(supabase, user.id);
    const resolution = await resolveFinancialState({
      trustedUserId: user.id,
      reader,
      nowIso: new Date().toISOString(),
    });

    return NextResponse.json(resolution, { status: 200, headers });
  } catch (error) {
    // Never log raw provider/database/auth error messages from the user-facing
    // finance route. Keep telemetry useful while avoiding SQL/provider detail
    // disclosure in server logs.
    console.error("Financial State v1 read failed", {
      category: classifyFinancialStateReadFailure(error),
    });

    return NextResponse.json(
      { error: "No pudimos cargar tu estado financiero en este momento." },
      { status: 503, headers },
    );
  }
}
