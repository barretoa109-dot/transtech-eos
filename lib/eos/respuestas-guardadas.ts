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
