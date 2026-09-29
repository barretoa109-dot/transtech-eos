/**
 * El buzón de respuestas del chat (v196): que un corte de conexión no pierda
 * una respuesta que el servidor sí terminó. Ver la migración para el caso real.
 *
 * Nunca lanza: guardar o leer el buzón es una red de seguridad, y un fallo acá
 * no puede convertirse en un segundo error sobre la respuesta que ya salió.
 */

import { adminSinTipos } from "../supabase/sin-tipos.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETENCION_MS = 24 * 3_600_000;

export function esRequestIdValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

export async function guardarRespuesta(
  usuarioId: string,
  requestId: unknown,
  estadoHttp: number,
  cuerpo: Record<string, unknown>,
): Promise<void> {
  if (!esRequestIdValido(requestId)) return;

  try {
    const admin = adminSinTipos();

    const { error } = await admin.from("eos_respuestas_chat_v196").upsert({
      request_id: requestId,
      usuario_id: usuarioId,
      estado_http: estadoHttp,
      cuerpo,
    });
    if (error) console.error("EOS: no se pudo guardar la respuesta en el buzón:", error.message);

    // Buzón de paso: lo de más de un día de esta persona se va.
    await admin
      .from("eos_respuestas_chat_v196")
      .delete()
      .eq("usuario_id", usuarioId)
      .lt("creado_en", new Date(Date.now() - RETENCION_MS).toISOString());
  } catch (err) {
    console.error("EOS: no se pudo guardar la respuesta en el buzón:", err);
  }
}

export type RespuestaGuardada = { estado_http: number; cuerpo: Record<string, unknown> };

export async function leerRespuesta(
  usuarioId: string,
  requestId: unknown,
): Promise<RespuestaGuardada | null> {
  if (!esRequestIdValido(requestId)) return null;

  try {
    const { data, error } = await adminSinTipos()
      .from("eos_respuestas_chat_v196")
      .select("estado_http,cuerpo")
      .eq("request_id", requestId)
      .eq("usuario_id", usuarioId)
      .maybeSingle();

    if (error || !data) return null;
    return data as RespuestaGuardada;
  } catch {
    return null;
  }
}

/*
 * ============================================================
 * "YA LO TENGO": LA LLEGADA DE CADA PEDIDO (27/09/2026)
 * ============================================================
 *
 * El buzón guardaba solo la respuesta final. Si la conexión se cortaba
 * mientras el mensaje SUBÍA, el servidor nunca se enteraba, y la app se
 * quedaba esperando una respuesta que nadie estaba escribiendo (caso real,
 * ver `lib/eos/envio-confiable.ts`).
 *
 * Ahora `/api/eos` deja una fila "en proceso" apenas recibe el pedido. Con
 * eso la app puede preguntar si llegó —y reenviarlo si no— y un reenvío del
 * mismo `request_id` no se procesa dos veces.
 */

/** `estado_http` de la fila mientras el pedido se está trabajando. */
export const ESTADO_EN_PROCESO = 102;

/**
 * Pasado esto, una fila "en proceso" es de una función que murió sin
 * terminar (`maxDuration = 300` en `/api/eos`): un reenvío la retoma.
 */
export const VIGENCIA_EN_PROCESO_MS = 320_000;

export type Llegada =
  | { tipo: "nuevo" }
  | { tipo: "en_proceso" }
  | { tipo: "terminado"; guardada: RespuestaGuardada }
  | { tipo: "ajeno" };

/**
 * Anota que el pedido llegó, o dice qué pasa con uno que ya había llegado.
 *
 * Nunca lanza, y ante cualquier falla dice "nuevo": esta anotación es una red
 * de seguridad, y un error acá no puede frenar un mensaje que sí llegó bien.
 */
export async function anotarLlegada(usuarioId: string, requestId: unknown): Promise<Llegada> {
  if (!esRequestIdValido(requestId)) return { tipo: "nuevo" };

  try {
    const admin = adminSinTipos();

    const { data: insertada, error } = await admin
      .from("eos_respuestas_chat_v196")
      .upsert(
        { request_id: requestId, usuario_id: usuarioId, estado_http: ESTADO_EN_PROCESO, cuerpo: {} },
        { onConflict: "request_id", ignoreDuplicates: true },
      )
      .select("request_id");

    if (error) {
      console.error("EOS: no se pudo anotar la llegada del pedido:", error.message);
      return { tipo: "nuevo" };
    }
    if (Array.isArray(insertada) && insertada.length > 0) return { tipo: "nuevo" };

    const { data: previa } = await admin
      .from("eos_respuestas_chat_v196")
      .select("usuario_id,estado_http,cuerpo,creado_en")
      .eq("request_id", requestId)
      .maybeSingle();

    if (!previa) return { tipo: "nuevo" };
    if (previa.usuario_id !== usuarioId) return { tipo: "ajeno" };

    if (previa.estado_http !== ESTADO_EN_PROCESO) {
      return { tipo: "terminado", guardada: { estado_http: previa.estado_http, cuerpo: previa.cuerpo } };
    }

    const edad = Date.now() - new Date(previa.creado_en).getTime();
    if (edad < VIGENCIA_EN_PROCESO_MS) return { tipo: "en_proceso" };

    // Quedó colgada de una función que murió: se retoma desde ahora.
    await admin
      .from("eos_respuestas_chat_v196")
      .update({ creado_en: new Date().toISOString() })
      .eq("request_id", requestId);
    return { tipo: "nuevo" };
  } catch (err) {
    console.error("EOS: no se pudo anotar la llegada del pedido:", err);
    return { tipo: "nuevo" };
  }
}

/**
 * ¿Le llegó este pedido al servidor? Además de la fila del buzón, mira la
 * reserva de cupo: si anotar la llegada falló, la reserva igual lo delata, y
 * la app no reenvía algo que se está trabajando.
 */
export async function pedidoRecibido(usuarioId: string, requestId: unknown): Promise<boolean> {
  if (!esRequestIdValido(requestId)) return false;

  try {
    const { data } = await adminSinTipos()
      .from("eos_message_usage_v40")
      .select("request_id")
      .eq("usuario_id", usuarioId)
      .eq("request_id", requestId)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
