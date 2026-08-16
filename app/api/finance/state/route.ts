import { NextResponse } from "next/server";
import {
  financialStateApiHeaders,
  isFinancialStateApiEnabled,
} from "@/lib/financial-autopilot/financial-state-api-policy";
import {
  resolveFinancialState,
  SupabaseFinancialStateReaderV1_1,
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

  try {
    const reader = new SupabaseFinancialStateReaderV1_1(supabase, user.id);
    const resolution = await resolveFinancialState({
      trustedUserId: user.id,
      reader,
      nowIso: new Date().toISOString(),
    });

    return NextResponse.json(resolution, { status: 200, headers });
  } catch (error) {
    console.error("Financial State v1 read failed", {
      code: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json(
      { error: "No pudimos cargar tu estado financiero en este momento." },
      { status: 503, headers },
    );
  }
}
