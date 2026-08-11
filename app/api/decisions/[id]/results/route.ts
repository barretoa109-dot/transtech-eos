import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const VALID_TYPES = new Set(["positivo", "neutral", "negativo", "inconcluso", "observacion"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const resumen = typeof body?.resumen === "string" ? body.resumen.trim().slice(0, 3000) : "";
  const aprendizaje = typeof body?.aprendizaje === "string" ? body.aprendizaje.trim().slice(0, 3000) : "";
  const tipo = VALID_TYPES.has(body?.tipo) ? body.tipo : "observacion";

  if (!resumen) {
    return NextResponse.json({ error: "El resultado es obligatorio." }, { status: 400 });
  }

  const { data: decision } = await supabase
    .from("eos_decisions")
    .select("id")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (!decision) {
    return NextResponse.json({ error: "Decisión no encontrada." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("eos_decision_results")
    .insert({
      decision_id: id,
      usuario_id: user.id,
      tipo,
      resumen,
      aprendizaje: aprendizaje || null,
      fuente: "eos-web",
    })
    .select("*")
    .single();

  if (error) {
    console.error("No se pudo registrar el resultado:", error);
    return NextResponse.json({ error: "No pudimos registrar el resultado." }, { status: 500 });
  }

  return NextResponse.json({ result: data }, { status: 201 });
}
