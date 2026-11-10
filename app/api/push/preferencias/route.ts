import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * El interruptor del push motivacional (hasta 3 veces al día).
 *
 * Misma tabla que los demás avisos —`eos_followup_preferences`— para que la
 * persona no tenga un lugar nuevo donde apagar algo. Sin fila, o sin dato, es
 * "sí": arranca encendido (decisión del dueño, 2026-11-10).
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
    .select("avisos_motivacionales_push")
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Push: no se pudo leer la preferencia de motivacionales:", error);
    return NextResponse.json({ error: "No pudimos cargar tu preferencia." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json(
    { avisos_motivacionales_push: data?.avisos_motivacionales_push ?? true },
    { headers: noStore() },
  );
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

  let cuerpo: { avisos_motivacionales_push?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (typeof cuerpo.avisos_motivacionales_push !== "boolean") {
    return NextResponse.json(
      { error: "avisos_motivacionales_push debe ser verdadero o falso." },
      { status: 400, headers: noStore() },
    );
  }

  // upsert y no update: la mayoría todavía no tiene fila, y apagar el aviso no
  // debería depender de que alguien la haya creado antes.
  const { error } = await supabase
    .from("eos_followup_preferences")
    .upsert(
      {
        usuario_id: user.id,
        avisos_motivacionales_push: cuerpo.avisos_motivacionales_push,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "usuario_id" },
    );

  if (error) {
    console.error("Push: no se pudo guardar la preferencia de motivacionales:", error);
    return NextResponse.json({ error: "No pudimos guardar tu preferencia." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json(
    { ok: true, avisos_motivacionales_push: cuerpo.avisos_motivacionales_push },
    { headers: noStore() },
  );
}
