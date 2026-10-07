import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { claveApns, enviarApns, type AvisoNativo, type ResultadoApns } from "./apns.ts";
import { cuentaDeServicio, enviarFcm, type ResultadoFcm } from "./fcm.ts";

const SIN_ENVIOS: ResultadoFcm = { enviados: 0, fallidos: 0, muertos: [] };

function combinar(android: ResultadoFcm, ios: ResultadoApns): ResultadoFcm {
  return {
    enviados: android.enviados + ios.enviados,
    fallidos: android.fallidos + ios.fallidos,
    muertos: [...android.muertos, ...ios.muertos],
  };
}

/**
 * Avisa a los teléfonos de una persona, Android por FCM e iOS por APNs.
 *
 * Sin ninguna de las dos configuradas no consulta nada y no envía nada. Los
 * tokens que cada servicio da por muertos se borran de `dispositivos_push`,
 * para no volver a intentar contra un teléfono que ya no tiene la app. Nunca
 * lanza error: el aviso por otros canales no puede caerse por esto.
 */
export async function avisarNativo(
  admin: ClienteSinTipos,
  usuarioId: string,
  aviso: AvisoNativo,
): Promise<ResultadoFcm> {
  if (!cuentaDeServicio() && !claveApns()) return SIN_ENVIOS;

  try {
    const { data, error } = await admin
      .from("dispositivos_push")
      .select("plataforma, token")
      .eq("usuario_id", usuarioId);

    if (error || !data || data.length === 0) return SIN_ENVIOS;

    const dispositivos = data as { plataforma: "android" | "ios"; token: string }[];
    const tokensAndroid = dispositivos.filter((d) => d.plataforma === "android").map((d) => d.token);
    const tokensIos = dispositivos.filter((d) => d.plataforma === "ios").map((d) => d.token);

    const [resultadoAndroid, resultadoIos] = await Promise.all([
      enviarFcm(tokensAndroid, aviso),
      enviarApns(tokensIos, aviso),
    ]);
    const resultado = combinar(resultadoAndroid, resultadoIos);

    if (resultado.muertos.length > 0) {
      await admin.from("dispositivos_push").delete().in("token", resultado.muertos);
    }
    return resultado;
  } catch {
    return SIN_ENVIOS;
  }
}
