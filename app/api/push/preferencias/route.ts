import { NextResponse } from "next/server";

import {
  cambioDePreferencia,
  esClaveDeNotificacion,
  leerPreferencias,
  type FilaDePreferencias,
} from "@/lib/push/preferencias";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Qué notificaciones recibe la persona en la app, una por una (v260).
 *
 * Misma tabla que los demás avisos —`eos_followup_preferences`— para que no
 * haya un lugar nuevo donde apagar algo. Sin fila, o sin dato, es "sí": todo
 * arranca encendido (decisión del dueño, 2026-11-10).
 *
 * Qué interruptores hay y qué columna toca cada uno está en
 * `lib/push/preferencias.ts`, que es lo mismo que leen los envíos.
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

  // `*` y no la lista de columnas: si la migración v260 todavía no corrió, una
  // columna nombrada que no existe hace fallar la lectura entera, y la pantalla
  // quedaría en blanco en vez de mostrar todo encendido.
  const { data, error } = await supabase
    .from("eos_followup_preferences")
    .select("*")
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Push: no se pudieron leer las preferencias de notificaciones:", error);
    return NextResponse.json({ error: "No pudimos cargar tus preferencias." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json(leerPreferencias(data as FilaDePreferencias), { headers: noStore() });
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

  let cuerpo: { clave?: unknown; valor?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (!esClaveDeNotificacion(cuerpo.clave) || typeof cuerpo.valor !== "boolean") {
    return NextResponse.json(
      { error: "Hace falta `clave` (una notificación conocida) y `valor` (verdadero o falso)." },
      { status: 400, headers: noStore() },
    );
  }

  const { data: actual, error: errorLectura } = await supabase
    .from("eos_followup_preferences")
    .select("*")
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (errorLectura) {
    console.error("Push: no se pudieron leer las preferencias antes de guardar:", errorLectura);
    return NextResponse.json({ error: "No pudimos guardar tu preferencia." }, { status: 503, headers: noStore() });
  }

  const cambio = cambioDePreferencia(actual as FilaDePreferencias, cuerpo.clave, cuerpo.valor);

  // upsert y no update: la mayoría todavía no tiene fila, y apagar un aviso no
  // debería depender de que alguien la haya creado antes.
  const { error } = await supabase
    .from("eos_followup_preferences")
    .upsert({ usuario_id: user.id, ...cambio, updated_at: new Date().toISOString() }, { onConflict: "usuario_id" });

  if (error) {
    console.error("Push: no se pudo guardar la preferencia de notificaciones:", error);
    return NextResponse.json({ error: "No pudimos guardar tu preferencia." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json(
    { ok: true, ...leerPreferencias({ ...(actual as Record<string, boolean> | null), ...cambio }) },
    { headers: noStore() },
  );
}
