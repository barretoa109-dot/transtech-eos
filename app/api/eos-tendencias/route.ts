import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      { status: 401, headers: HEADERS },
    );
  }

  const { data, error } = await supabase
    .from("eos_tendencias")
    .select("id,score_actual,score_anterior,diferencia,tendencia,created_at")
    .eq("usuario_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("No se pudieron cargar tendencias EOS:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus tendencias." },
      { status: 500, headers: HEADERS },
    );
  }

  return NextResponse.json({ data: data ?? [] }, { headers: HEADERS });
}
