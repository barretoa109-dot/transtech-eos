import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { ClienteSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { diasDeProgreso } from "@/lib/finanzas/progreso";

export const dynamic = "force-dynamic";

/**
 * "Cómo venís": acciones completadas por día, últimos 14 días.
 *
 * Todo pasa con la sesión de la persona: la RLS de `eos_action_commands` ya
 * impide leer órdenes de otra cuenta. Se cuenta cualquier acción completada
 * que no sea RESPONDER (conversar no es "hacer algo"), sin filtrar por
 * ámbito: es el mismo criterio que ya usa `dias_activos` en
 * `eos_analitica_usuario_v172`, y "cómo venís" es sobre el uso de EOS en
 * general, no solo sobre la plata.
 */
export async function GET() {
  const supabase = (await createClient()) as ClienteSinTipos;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return respuesta("Sesión no válida.", 401);

  const hoy = hoyEnParaguay();
  // 15 días, no 14: el día más viejo de la ventana de Paraguay puede empezar
  // horas antes en UTC, así que se pide un margen y se recorta después.
  const desdeUTC = `${sumarDias(hoy, -15)}T00:00:00Z`;

  const { data, error } = await supabase
    .from("eos_action_commands")
    .select("created_at")
    .eq("usuario_id", user.id)
    .eq("estado", "completada")
    .neq("accion", "RESPONDER")
    .gte("created_at", desdeUTC)
    .limit(5000);

  if (error) {
    console.error("Finanzas: no se pudo calcular el progreso:", error);
    return respuesta("No pudimos calcular cómo venís.", 503);
  }

  const filas = (data ?? []) as { created_at: string }[];
  const dias = diasDeProgreso(
    filas.map((f) => f.created_at),
    hoy,
  );

  return NextResponse.json({ dias }, { headers: { "Cache-Control": "no-store" } });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
