import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { BUCKET_FOTOS_CHAT, fotosDeMetadata, rutaEsDe } from "@/lib/eos/fotos-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Eliminar un chat desde el menú de tres puntos de la barra lateral.
 *
 * Es una ruta y no un `delete` desde el navegador por las fotos: las que la
 * persona mandó en ese chat viven en un bucket privado donde el navegador no
 * tiene permiso de borrar. Si el chat se borrara sin ellas, quedarían
 * guardadas fotos de una conversación que la persona cree eliminada.
 *
 * Todo lo que toca la base va con la sesión: la RLS de `conversaciones` y de
 * `mensajes` solo deja ver y borrar lo propio, así que un id ajeno responde
 * 404 igual que uno que no existe. El cliente de servicio se usa solo para
 * el bucket, y solo con rutas bajo la carpeta de quien pide (`rutaEsDe`).
 *
 * Los mensajes se van con la conversación (foránea con cascade). Memoria,
 * objetivos y decisiones que nacieron en este chat se quedan: su
 * `conversacion_id` pasa a null, porque lo que la persona decidió no deja de
 * valer por borrar dónde lo dijo.
 */
export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404, headers: noStore() });
  }

  const { data: conversacion } = await supabase
    .from("conversaciones")
    .select("id")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (!conversacion) {
    return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404, headers: noStore() });
  }

  // Las rutas se leen ANTES de borrar: después, los mensajes ya no están.
  const { data: conFotos } = await supabase
    .from("mensajes")
    .select("metadata")
    .eq("conversacion_id", id)
    .eq("usuario_id", user.id)
    .not("metadata->imagenes", "is", null);

  const rutas = [
    ...new Set(
      (conFotos ?? [])
        .flatMap((m) => fotosDeMetadata(m.metadata).map((f) => f.ruta))
        .filter((r) => rutaEsDe(user.id, r)),
    ),
  ];

  const { error } = await supabase.from("conversaciones").delete().eq("id", id).eq("usuario_id", user.id);

  if (error) {
    console.error("Chat: no se pudo eliminar la conversación:", error);
    return NextResponse.json(
      { error: "No pudimos eliminar la conversación. Probá de nuevo en un momento." },
      { status: 500, headers: noStore() },
    );
  }

  // El chat ya no está. Si las fotos fallan, se anota y no se le devuelve un
  // error a la persona: lo que pidió, que el chat desaparezca, ya pasó.
  if (rutas.length > 0) {
    const { error: errorFotos } = await createAdminClient().storage.from(BUCKET_FOTOS_CHAT).remove(rutas);
    if (errorFotos) console.error("Chat: la conversación se borró pero quedaron fotos:", errorFotos);
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
