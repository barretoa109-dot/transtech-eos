import { createClient } from "@/lib/supabase/server";
import { esRequestIdValido, leerRespuesta } from "@/lib/eos/respuestas-guardadas";

export const dynamic = "force-dynamic";

/**
 * La respuesta de un pedido al chat cuya conexión se cortó (v196).
 *
 * La app la pide cuando el `fetch` a `/api/eos` murió por la red: el servidor
 * pudo haber terminado igual. `listo: false` quiere decir "todavía no" (o que
 * nunca llegó), y la app sigue preguntando un rato antes de rendirse.
 *
 * Solo devuelve respuestas de la persona de la sesión: la consulta filtra por
 * su `usuario_id`, así que un request_id ajeno da `listo: false`.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

  if (error || !user) {
    return Response.json({ listo: false, error: "sesion" }, { status: 401, headers });
  }

  const requestId = new URL(req.url).searchParams.get("request_id");
  if (!esRequestIdValido(requestId)) {
    return Response.json({ listo: false, error: "request_id" }, { status: 400, headers });
  }

  const guardada = await leerRespuesta(user.id, requestId);
  if (!guardada) return Response.json({ listo: false }, { headers });

  return Response.json(
    { listo: true, estado_http: guardada.estado_http, cuerpo: guardada.cuerpo },
    { headers },
  );
}
