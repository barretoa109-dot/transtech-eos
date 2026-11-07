import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

/**
 * Revocar una clave propia. Nunca se borra la fila (ver la migración v254):
 * queda como evidencia de que existió y cuándo se usó por última vez.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: usuario, error: usuarioError } = await supabase.auth.getUser();
  if (usuarioError || !usuario?.user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401, headers: noStore() });
  }

  const { id } = await params;

  // La RLS (`eos_api_keys_update_revocar_propia`) ya exige que sea propia y
  // que no esté revocada: este filtro extra solo evita la vuelta al cliente
  // con "0 filas" sin saber por qué.
  const { data, error } = await supabase
    .from("eos_api_keys")
    .update({ revocada_en: new Date().toISOString() })
    .eq("id", id)
    .eq("usuario_id", usuario.user.id)
    .is("revocada_en", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Developer Platform: no se pudo revocar la clave:", error);
    return NextResponse.json({ error: "No pudimos revocarla." }, { status: 503, headers: noStore() });
  }

  if (!data) {
    return NextResponse.json({ error: "No encontramos esa clave, o ya estaba revocada." }, { status: 404, headers: noStore() });
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}
