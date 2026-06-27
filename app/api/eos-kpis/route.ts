import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
  .from('eos_kpis')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(1)

  return NextResponse.json({ data, error });
}