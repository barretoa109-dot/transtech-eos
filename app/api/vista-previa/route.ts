import { createClient } from "@/lib/supabase/server";
import { leerVistaPrevia, type VistaPrevia } from "@/lib/vista-previa/leer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Vista previa de una fuente web para la tarjeta del chat (01/10/2026).
 * Solo con sesión: no es un proxy público. La lectura cuida SSRF
 * (lib/vista-previa/leer.ts). Caché en memoria por instancia y en el
 * navegador por un día: la misma fuente no se vuelve a pedir.
 */
const CACHE = new Map<string, { valor: VistaPrevia | null; vence: number }>();
const MAX_CACHE = 300;
const UN_DIA = 24 * 3600_000;

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sesion" }, { status: 401 });

  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url || url.length > 2000) return Response.json({ error: "url" }, { status: 400 });

  const guardado = CACHE.get(url);
  let vista: VistaPrevia | null;
  if (guardado && guardado.vence > Date.now()) {
    vista = guardado.valor;
  } else {
    vista = await leerVistaPrevia(url);
    if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value as string);
    CACHE.set(url, { valor: vista, vence: Date.now() + UN_DIA });
  }

  return Response.json(vista ?? { url, sitio: null, titulo: null, descripcion: null, imagen: null }, {
    headers: { "Cache-Control": "private, max-age=86400" },
  });
}
