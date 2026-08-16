import { NextResponse } from "next/server";
import {
  classifyFinancialStateReadFailure,
  financialStateApiHeaders,
  isFinancialStateApiEnabled,
  isFinancialStateV1_2Enabled,
  isFinancialStateV1_3Enabled,
} from "@/lib/financial-autopilot/financial-state-api-policy";
import {
  resolveFinancialState,
  SupabaseFinancialStateReaderV1_1,
  SupabaseFinancialStateReaderV1_2,
  SupabaseFinancialStateReaderV1_3,
} from "@/lib/financial-autopilot/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = financialStateApiHeaders();

  // Server-only kill switch. The route exists in code but stays dark until the
  // finance-v1 persistence layers have been validated outside production and
  // explicitly enabled.
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

    const v1_2Enabled = isFinancialStateV1_2Enabled();
    const v1_3Enabled = v1_2Enabled && isFinancialStateV1_3Enabled();

    // Rollout is strictly layered. v1.3 may only run on top of v1.2, so source
    // coverage can never bypass the critical-obligation completeness gate.
    // Missing schema/columns fail closed with 503; there is no silent downgrade.
    const reader = v1_3Enabled
      ? new SupabaseFinancialStateReaderV1_3(supabase, user.id)
      : v1_2Enabled
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
