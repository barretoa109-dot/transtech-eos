import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const usuario_id = searchParams.get("usuario_id");

  if (!usuario_id) {
    return NextResponse.json(
      { error: "Falta usuario_id" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("eos_daily_briefings")
    .select("*")
    .eq("usuario_id", usuario_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    briefing: data || null,
  });
}