import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { ClienteSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * Las correcciones de categoría que EOS recuerda, para poder verlas y olvidar
 * una que salió mal.
 *
 * Todo pasa con la sesión de la persona: la RLS de `eos_reglas_categoria`
 * (v234) ya impide ver o borrar reglas de otra cuenta.
 */

const ID_VALIDO = /^[0-9a-f-]{36}$/i;

export async function GET() {
  const supabase = (await createClient()) as ClienteSinTipos;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return respuesta("Sesión no válida.", 401);

  const { data, error } = await supabase
    .from("eos_reglas_categoria")
    .select("id,patron,categoria,actualizada_en")
    .eq("usuario_id", user.id)
    .order("actualizada_en", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Finanzas: no se pudieron leer las reglas de categoría:", error);
    return respuesta("No pudimos cargar lo que EOS aprendió.", 503);
  }

  return NextResponse.json({ reglas: data ?? [] }, { headers: noStore() });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID_VALIDO.test(id)) return respuesta("Regla no encontrada.", 404);

  const supabase = (await createClient()) as ClienteSinTipos;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return respuesta("Sesión no válida.", 401);

  const { data, error } = await supabase
    .from("eos_reglas_categoria")
    .delete()
    .eq("id", id)
    .eq("usuario_id", user.id)
    .select("id");

  if (error) {
    console.error("Finanzas: no se pudo olvidar la regla de categoría:", error);
    return respuesta("No pudimos olvidarla.", 503);
  }

  if (!data || data.length === 0) return respuesta("Regla no encontrada.", 404);

  return NextResponse.json({ olvidada: true }, { headers: noStore() });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "no-store" };
}
