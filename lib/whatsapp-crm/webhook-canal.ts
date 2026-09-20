import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { estadoDePlantilla } from "./meta.ts";

/**
 * Lo que el webhook necesita de la base para atender canales de empresa.
 *
 * Son tres lecturas/escrituras chicas, separadas de la ruta para poder probarlas:
 *
 *   · los secretos de app por `phone_number_id` (para validar la firma),
 *   · si un token de verificación es de algún canal (el apretón de manos de Meta),
 *   · el aviso de Meta de que una plantilla fue aprobada o rechazada.
 *
 * Una tabla que todavía no existe (la v185 sin aplicar) NO puede tumbar el webhook
 * del canal principal: cada función lo trata como "no hay canales de empresa".
 */

const TABLA_AUSENTE = new Set(["42P01", "PGRST205", "42703", "42883"]);

const esTablaAusente = (error: unknown) => TABLA_AUSENTE.has(String((error as { code?: unknown } | null)?.code ?? ""));

/** El secreto de app de cada número que tenga uno propio. Los demás quedan en null. */
export async function secretosDeApp(admin: ClienteSinTipos, ids: string[]): Promise<Map<string, string | null>> {
  const secretos = new Map<string, string | null>();

  for (const id of ids) {
    const { data, error } = await admin.rpc("eos_wa_secreto_app_de_numero_v185", { p_phone_number_id: id });

    if (error) {
      // Sin la función (v185 sin aplicar) no hay secretos propios: rige el global.
      if (esTablaAusente(error)) {
        secretos.set(id, null);
        continue;
      }
      // Cualquier otro error: no se puede afirmar que ese canal NO tenga secreto propio,
      // y validar con el global sería aceptar lo que firmó otra app. Se propaga.
      throw new Error(`No se pudo consultar el secreto de la app: ${(error as { message?: string }).message ?? "error"}`);
    }

    secretos.set(id, typeof data === "string" && data ? data : null);
  }

  return secretos;
}

/** ¿Este token de verificación es de algún canal de empresa que siga conectado? */
export async function tokenDeVerificacionValido(admin: ClienteSinTipos, token: string): Promise<boolean> {
  if (!token || token.length < 16) return false;

  const { data, error } = await admin
    .from("eos_wa_canales")
    .select("id")
    .eq("verify_token", token)
    .neq("estado", "desconectado")
    .maybeSingle();

  if (error) {
    if (!esTablaAusente(error)) console.error("WhatsApp empresa: no se pudo comprobar el token de verificación:", error);
    return false;
  }

  return Boolean(data);
}

export type AvisoDePlantilla = {
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
};

/**
 * Meta avisa (campo `message_template_status_update`) cuando revisa una plantilla.
 * Solo se toca una plantilla de un canal CUYA cuenta (`waba_id`) coincide: un aviso
 * con el nombre de una plantilla ajena no puede cambiar la de otra empresa.
 */
export async function aplicarEstadoDePlantilla(
  admin: ClienteSinTipos,
  wabaId: string,
  aviso: AvisoDePlantilla,
): Promise<{ actualizadas: number }> {
  const nombre = String(aviso.message_template_name ?? "").trim();
  if (!/^[0-9]{5,30}$/.test(wabaId) || !nombre || !aviso.event) return { actualizadas: 0 };

  const { data: canales, error } = await admin.from("eos_wa_canales").select("id").eq("waba_id", wabaId);

  if (error) {
    if (!esTablaAusente(error)) console.error("WhatsApp empresa: no se pudieron leer los canales de la cuenta:", error);
    return { actualizadas: 0 };
  }

  const ids = ((canales ?? []) as { id: string }[]).map((c) => c.id);
  if (ids.length === 0) return { actualizadas: 0 };

  const estado = estadoDePlantilla(aviso.event);

  const { data } = await admin
    .from("eos_wa_plantillas")
    .update({
      estado,
      motivo_rechazo: estado === "rechazada" ? String(aviso.reason ?? "").slice(0, 300) || null : null,
      actualizado_en: new Date().toISOString(),
    })
    .in("canal_id", ids)
    .eq("nombre", nombre)
    .select("id");

  return { actualizadas: Array.isArray(data) ? data.length : 0 };
}
