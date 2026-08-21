import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Alta y baja de una suscripción push.
 *
 * Un usuario puede tener varias: el navegador del teléfono, el de la
 * notebook, la PWA instalada. Cada endpoint es una fila; el `upsert` sobre
 * `endpoint` hace que resuscribirse en el mismo dispositivo actualice su fila
 * en vez de acumular duplicados que dispararían la misma notificación dos
 * veces en la misma pantalla.
 */

type Cuerpo = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: Cuerpo;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: "Suscripción incompleta." },
      { status: 400, headers: noStore() },
    );
  }

  const { error } = await supabase.from("eos_push_suscripciones").upsert(
    {
      usuario_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
      activa: true,
      ultimo_error: null,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("Push: no se pudo guardar la suscripción:", error);
    return NextResponse.json(
      { error: "No pudimos activar las notificaciones." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

/** Baja. Darse de baja tiene que ser tan simple como suscribirse. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let endpoint = "";
  try {
    const body = (await request.json()) as Cuerpo;
    endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  } catch {
    // Sin endpoint se dan de baja todos los dispositivos del usuario.
  }

  const query = supabase.from("eos_push_suscripciones").delete().eq("usuario_id", user.id);
  const { error } = endpoint ? await query.eq("endpoint", endpoint) : await query;

  if (error) {
    console.error("Push: no se pudo borrar la suscripción:", error);
    return NextResponse.json(
      { error: "No pudimos desactivar las notificaciones." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
