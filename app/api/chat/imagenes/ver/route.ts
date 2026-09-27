import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { BUCKET_FOTOS_CHAT, SEGUNDOS_ENLACE_FOTO, rutaEsDe } from "@/lib/eos/fotos-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuántas rutas se firman por pedido: una conversación larga con fotos. */
const MAX_RUTAS = 200;

/**
 * Enlaces de una hora para las fotos de una conversación.
 *
 * Se firma con el cliente de servicio, pero solo lo que está bajo la carpeta
 * del usuario de la sesión (`rutaEsDe`). Una ruta ajena no da error: no
 * aparece en la respuesta, igual que una que ya no existe.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let cuerpo: { rutas?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const pedidas = Array.isArray(cuerpo.rutas) ? cuerpo.rutas : [];
  const rutas = [...new Set(pedidas.filter((r): r is string => rutaEsDe(user.id, r)))].slice(0, MAX_RUTAS);

  if (rutas.length === 0) {
    return NextResponse.json({ urls: {} }, { headers: noStore() });
  }

  const { data, error } = await createAdminClient()
    .storage.from(BUCKET_FOTOS_CHAT)
    .createSignedUrls(rutas, SEGUNDOS_ENLACE_FOTO);

  if (error) {
    console.error("Fotos del chat: no se pudieron firmar los enlaces:", error);
    return NextResponse.json({ error: "No pudimos abrir las imágenes." }, { status: 503, headers: noStore() });
  }

  const urls: Record<string, string> = {};
  for (const firmada of data ?? []) {
    if (firmada.path && firmada.signedUrl && !firmada.error) urls[firmada.path] = firmada.signedUrl;
  }

  return NextResponse.json({ urls }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
