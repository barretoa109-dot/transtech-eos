import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authenticatedClient();
  if (auth.response) return auth.response;

  const { data, error } = await auth.supabase
    .from("eos_decision_registry_v6")
    .select("*")
    .eq("usuario_id", auth.userId)
    .order("fecha_decision", { ascending: false })
    .limit(100);

  if (error) return databaseError("cargar", error);
  return NextResponse.json({ decisions: data ?? [] }, { headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  const auth = await authenticatedClient();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const titulo = cleanText(body?.titulo, 180);
  const decision = cleanText(body?.decision, 3000);

  if (!titulo || !decision) {
    return NextResponse.json(
      { error: "El título y la decisión son obligatorios." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data, error } = await auth.supabase
    .from("eos_decisions")
    .insert({
      usuario_id: auth.userId,
      titulo,
      decision,
      contexto: cleanText(body?.contexto, 4000) || null,
      razon: cleanText(body?.razon, 4000) || null,
      resultado_esperado: cleanText(body?.resultado_esperado, 3000) || null,
      metrica: cleanText(body?.metrica, 180) || null,
      unidad: cleanText(body?.unidad, 80) || null,
      fecha_revision: validDate(body?.fecha_revision),
      fuente: "eos-web",
    })
    .select("*")
    .single();

  if (error) return databaseError("registrar", error);
  return NextResponse.json({ decision: data }, { status: 201, headers: noStoreHeaders() });
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      supabase,
      userId: "",
      response: NextResponse.json(
        { error: "Sesión no válida." },
        { status: 401, headers: noStoreHeaders() },
      ),
    };
  }

  return { supabase, userId: user.id, response: null };
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function databaseError(action: string, error: unknown) {
  console.error(`No se pudo ${action} la decisión:`, error);
  return NextResponse.json(
    { error: `No pudimos ${action} la decisión en este momento.` },
    { status: 500, headers: noStoreHeaders() },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
