import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { enviarFcm, type AvisoNativo, type ResultadoFcm } from "./fcm";

/**
 * Avisa a los teléfonos nativos de una persona. Por ahora solo Android: los
 * tokens de iOS quedan guardados y se enviarán cuando esté APNs.
 *
 * Los tokens que FCM da por muertos se borran de `dispositivos_push`, para no
 * volver a intentar contra un teléfono que ya no tiene la app.
 */
export async function avisarNativo(usuarioId: string, aviso: AvisoNativo): Promise<ResultadoFcm> {
  const admin = adminSinTipos();
  const { data, error } = await admin
    .from("dispositivos_push")
    .select("token")
    .eq("usuario_id", usuarioId)
    .eq("plataforma", "android");

  if (error || !data || data.length === 0) {
    return { enviados: 0, fallidos: 0, muertos: [] };
  }

  const tokens = (data as { token: string }[]).map((fila) => fila.token);
  const resultado = await enviarFcm(tokens, aviso);

  if (resultado.muertos.length > 0) {
    await admin.from("dispositivos_push").delete().in("token", resultado.muertos);
  }

  return resultado;
}
