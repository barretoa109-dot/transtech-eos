import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { leerDispositivoPush } from "@/lib/push/dispositivo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La app nativa registra acá el token de push de su teléfono, para la persona
 * que tiene la sesión. Un token ya guardado pasa a la persona que lo registra
 * (por ejemplo, si cambió de cuenta en el mismo teléfono).
 *
 * El usuario sale de la sesión, nunca del cuerpo del pedido.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No hay sesión." }, { status: 401 });
  }

  const dispositivo = leerDispositivoPush(await request.json().catch(() => null));
  if (!dispositivo) {
    return NextResponse.json({ error: "Dispositivo inválido." }, { status: 400 });
  }

  // La tabla es nueva y los tipos generados todavía no la conocen: ver sin-tipos.ts.
  const { error } = await adminSinTipos()
    .from("dispositivos_push")
    .upsert(
      {
        usuario_id: user.id,
        plataforma: dispositivo.plataforma,
        token: dispositivo.token,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

  if (error) {
    return NextResponse.json({ error: "No se pudo guardar el dispositivo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Al cerrar sesión, el teléfono deja de recibir avisos de esa persona. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No hay sesión." }, { status: 401 });
  }

  const dispositivo = leerDispositivoPush(await request.json().catch(() => null));
  if (!dispositivo) {
    return NextResponse.json({ error: "Dispositivo inválido." }, { status: 400 });
  }

  const { error } = await adminSinTipos()
    .from("dispositivos_push")
    .delete()
    .eq("token", dispositivo.token)
    .eq("usuario_id", user.id);

  if (error) {
    return NextResponse.json({ error: "No se pudo borrar el dispositivo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
