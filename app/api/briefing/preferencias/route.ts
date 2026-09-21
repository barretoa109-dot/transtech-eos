import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Preferencias de entrega del briefing.
 *
 * Se apoya en `eos_followup_preferences`, que ya existía con los campos
 * exactos que hacen falta (canal_email, zona_horaria, hora_local, horas de
 * silencio). Reutilizarla en vez de crear otra tabla evita el problema
 * clásico de tener dos lugares donde el usuario apaga lo mismo y solo uno
 * se respeta.
 *
 * `canal_email` viene en `false` por defecto: el briefing por correo es
 * opt-in. Mandarle a alguien un correo diario que no pidió es la forma más
 * rápida de que marque a EOS como spam y no vuelva a leer nada.
 */

type Preferencias = {
  canal_email: boolean;
  avisos_riesgo_correo: boolean | null;
  hora_local: number | null;
  zona_horaria: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_followup_preferences")
    .select("canal_email,avisos_riesgo_correo,hora_local,zona_horaria")
    .eq("usuario_id", user.id)
    .maybeSingle<Preferencias>();

  if (error) {
    console.error("No se pudieron leer las preferencias de briefing:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus preferencias." },
      { status: 500, headers: noStore() },
    );
  }

  // Sin fila todavía: se responde con el default de la tabla en vez de
  // crearla. Una fila solo aparece cuando el usuario decide algo.
  return NextResponse.json(
    {
      canal_email: data?.canal_email ?? false,
      // Los avisos de riesgo arrancan encendidos (v188): sin fila, o sin dato, es "sí".
      avisos_riesgo_correo: data?.avisos_riesgo_correo ?? true,
      hora_local: data?.hora_local ?? 8,
      zona_horaria: data?.zona_horaria ?? "America/Asuncion",
    },
    { headers: noStore() },
  );
}

/** Activa o desactiva el briefing por correo y/o los avisos de riesgo por correo. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: { canal_email?: unknown; avisos_riesgo_correo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const cambios: Record<string, boolean> = {};

  for (const campo of ["canal_email", "avisos_riesgo_correo"] as const) {
    const valor = body[campo];
    if (valor === undefined) continue;
    if (typeof valor !== "boolean") {
      return NextResponse.json(
        { error: `${campo} debe ser verdadero o falso.` },
        { status: 400, headers: noStore() },
      );
    }
    cambios[campo] = valor;
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400, headers: noStore() });
  }

  // upsert y no update: la mayoría de los usuarios todavía no tiene fila, y
  // activar el correo no debería depender de que alguien la haya creado antes.
  const { error } = await supabase
    .from("eos_followup_preferences")
    .upsert(
      { usuario_id: user.id, ...cambios, updated_at: new Date().toISOString() },
      { onConflict: "usuario_id" },
    );

  if (error) {
    console.error("No se pudo guardar la preferencia de briefing:", error);
    return NextResponse.json(
      { error: "No pudimos guardar tu preferencia." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true, ...cambios }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
