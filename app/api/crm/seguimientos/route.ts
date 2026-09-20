import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { leerSeguimientos } from "@/lib/crm/seguimientos-datos";
import { titularDeSeguimientos } from "@/lib/crm/seguimientos";

export const dynamic = "force-dynamic";

/**
 * Los seguimientos del CRM: a quién hay que retomar hoy, y por qué.
 *
 * GET   la lista, ya calculada (`lib/crm/seguimientos.ts`), con un titular.
 * POST  { clave, estado: "hecho" | "pospuesto" | "descartado", dias? } recuerda qué
 *       pasó con un aviso, para que no vuelva a aparecer.
 *
 * Todo se lee y escribe con la SESIÓN de la persona: la RLS decide qué ve, y el
 * `usuario_id` sale de la sesión, nunca de un parámetro.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const ESTADOS = new Set(["hecho", "pospuesto", "descartado"]);

export async function GET() {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const hoy = hoyEnParaguay();

  try {
    const seguimientos = await leerSeguimientos(supabase as never, puerta.usuarioId, hoy);
    return NextResponse.json({ hoy, titular: titularDeSeguimientos(seguimientos), seguimientos }, { headers: noStore });
  } catch (error) {
    console.error("CRM: no se pudieron calcular los seguimientos:", error);
    // No se devuelve una lista vacía: "nada para retomar" con los datos sin verificar
    // es exactamente la mentira que este panel existe para evitar.
    return NextResponse.json(
      { error: "No pudimos calcular tus seguimientos. Reintentá en un momento." },
      { status: 503, headers: noStore },
    );
  }
}

export async function POST(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore });
  }

  const clave = String(cuerpo.clave ?? "").trim();
  const estado = String(cuerpo.estado ?? "");

  if (clave.length < 1 || clave.length > 200) {
    return NextResponse.json({ error: "Falta el seguimiento." }, { status: 400, headers: noStore });
  }
  if (!ESTADOS.has(estado)) {
    return NextResponse.json({ error: "Estado no válido." }, { status: 400, headers: noStore });
  }

  let hasta: string | null = null;
  if (estado === "pospuesto") {
    const dias = Number(cuerpo.dias ?? 3);
    if (!Number.isInteger(dias) || dias < 1 || dias > 60) {
      return NextResponse.json({ error: "Se puede posponer de 1 a 60 días." }, { status: 400, headers: noStore });
    }
    hasta = sumarDias(hoyEnParaguay(), dias);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("eos_crm_seguimientos_estado")
    .upsert(
      { usuario_id: puerta.usuarioId, clave, estado, hasta, actualizado_en: new Date().toISOString() },
      { onConflict: "usuario_id,clave" },
    );

  if (error) {
    // La tabla todavía no existe (v185 sin aplicar): no se puede recordar, y se dice.
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ error: "Esta función todavía no está disponible en tu cuenta." }, { status: 409, headers: noStore });
    }
    console.error("CRM: no se pudo guardar el estado del seguimiento:", error);
    return NextResponse.json({ error: "No pudimos guardarlo. Reintentá." }, { status: 503, headers: noStore });
  }

  return NextResponse.json({ ok: true, hasta }, { headers: noStore });
}
