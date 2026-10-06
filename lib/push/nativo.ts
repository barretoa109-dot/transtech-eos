import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { cuentaDeServicio, enviarFcm, type AvisoNativo, type ResultadoFcm } from "./fcm.ts";

const SIN_ENVIOS: ResultadoFcm = { enviados: 0, fallidos: 0, muertos: [] };

/**
 * Avisa a los teléfonos Android de una persona. Por ahora solo Android: los
 * tokens de iOS quedan guardados y se enviarán cuando esté APNs.
 *
 * Sin la cuenta de servicio de Firebase no consulta nada y no envía nada. Los
 * tokens que FCM da por muertos se borran de `dispositivos_push`, para no volver
 * a intentar contra un teléfono que ya no tiene la app. Nunca lanza error: el
 * aviso por otros canales no puede caerse por esto.
 */
export async function avisarNativo(
  admin: ClienteSinTipos,
  usuarioId: string,
  aviso: AvisoNativo,
): Promise<ResultadoFcm> {
  if (!cuentaDeServicio()) return SIN_ENVIOS;

  try {
    const { data, error } = await admin
      .from("dispositivos_push")
      .select("token")
      .eq("usuario_id", usuarioId)
      .eq("plataforma", "android");

    if (error || !data || data.length === 0) return SIN_ENVIOS;

    const tokens = (data as { token: string }[]).map((fila) => fila.token);
    const resultado = await enviarFcm(tokens, aviso);

    if (resultado.muertos.length > 0) {
      await admin.from("dispositivos_push").delete().in("token", resultado.muertos);
    }
    return resultado;
  } catch {
    return SIN_ENVIOS;
  }
}
