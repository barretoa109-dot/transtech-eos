import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { hashDeClave } from "./claves.ts";

/**
 * Resuelve el `Authorization: Bearer <clave>` de una ruta pública del
 * Developer Platform a la cuenta que esa clave representa.
 *
 * El `usuario_id` SIEMPRE sale de la tabla `eos_api_keys`, por el hash de la
 * clave presentada — nunca de un parámetro que mande el llamante. Es la
 * diferencia con `EOS_WORKER_GATE_SECRET` (un secreto único y compartido que
 * confía en que quien llama diga la verdad): acá cada clave resuelve a una
 * sola cuenta fija, así que no hay nada que un llamante pueda falsear.
 */
export type ClaveResuelta = { usuarioId: string; claveId: string };

export async function resolverClaveApi(admin: ClienteSinTipos, request: Request): Promise<ClaveResuelta | null> {
  const encabezado = request.headers.get("authorization") || "";
  const presentada = encabezado.startsWith("Bearer ") ? encabezado.slice(7).trim() : "";
  if (!presentada) return null;

  const { data, error } = await admin
    .from("eos_api_keys")
    .select("id,usuario_id")
    .eq("hash", hashDeClave(presentada))
    .is("revocada_en", null)
    .maybeSingle();

  if (error || !data) return null;

  const fila = data as { id: string; usuario_id: string };

  // Best-effort: si esto falla, la clave igual autentica. Es solo un dato de
  // uso para quien administra sus propias claves, no parte de la seguridad.
  try {
    await admin.from("eos_api_keys").update({ ultimo_uso_en: new Date().toISOString() }).eq("id", fila.id);
  } catch (err) {
    console.error("Developer Platform: no se pudo anotar el último uso de una clave:", err);
  }

  return { usuarioId: fila.usuario_id, claveId: fila.id };
}
