import { createClient } from "@/lib/supabase/server";
import {
  ESTADO_EN_PROCESO,
  esRequestIdValido,
  leerRespuesta,
  pedidoRecibido,
} from "@/lib/eos/respuestas-guardadas";

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
 *
 * `recibido` dice si el pedido llegó al servidor (27/09/2026). Con `false` la
 * app lo reenvía; con `true` sigue esperando. Ver `lib/eos/envio-confiable.ts`.
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
  if (!guardada || guardada.estado_http === ESTADO_EN_PROCESO) {
    const recibido = Boolean(guardada) || (await pedidoRecibido(user.id, requestId));
    return Response.json({ listo: false, recibido }, { headers });
  }

  return Response.json(
    { listo: true, recibido: true, estado_http: guardada.estado_http, cuerpo: guardada.cuerpo },
    { headers },
  );
}
