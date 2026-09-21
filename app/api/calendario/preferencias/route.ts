import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * El interruptor de los avisos de agenda.
 *
 * Vive en su propia ruta y no dentro de `/api/briefing/preferencias`: esa ruta la
 * tocan a la vez los avisos de riesgo y los correos motivacionales, y una más
 * agranda un archivo donde ya se pisaron dos veces. Usa la misma tabla —`eos_followup_preferences`—
 * para que la persona no tenga dos lugares donde apagar lo mismo.
 *
 * Sin fila, o sin dato, es "sí": son recordatorios que ella misma pidió, no un
 * boletín, y arrancan encendidos.
 */

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: errorSesion,
  } = await supabase.auth.getUser();

  if (errorSesion || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_followup_preferences")
    .select("avisos_agenda")
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Calendario: no se pudo leer la preferencia de avisos:", error);
    return NextResponse.json({ error: "No pudimos cargar tu preferencia." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ avisos_agenda: data?.avisos_agenda ?? true }, { headers: noStore() });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: errorSesion,
  } = await supabase.auth.getUser();

  if (errorSesion || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let cuerpo: { avisos_agenda?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (typeof cuerpo.avisos_agenda !== "boolean") {
    return NextResponse.json({ error: "avisos_agenda debe ser verdadero o falso." }, { status: 400, headers: noStore() });
  }

  // upsert y no update: la mayoría todavía no tiene fila, y apagar el aviso no
  // debería depender de que alguien la haya creado antes.
  const { error } = await supabase
    .from("eos_followup_preferences")
    .upsert(
      { usuario_id: user.id, avisos_agenda: cuerpo.avisos_agenda, updated_at: new Date().toISOString() },
      { onConflict: "usuario_id" },
    );

  if (error) {
    console.error("Calendario: no se pudo guardar la preferencia de avisos:", error);
    return NextResponse.json({ error: "No pudimos guardar tu preferencia." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ ok: true, avisos_agenda: cuerpo.avisos_agenda }, { headers: noStore() });
}
