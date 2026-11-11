import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { claveApns, enviarApns, type AvisoNativo, type ResultadoApns } from "./apns.ts";
import { cuentaDeServicio, enviarFcm, type ResultadoFcm } from "./fcm.ts";

/**
 * Cero enviados, pero diciendo por qué.
 *
 * Reemplazó a una constante `SIN_ENVIOS` muda: ya no hay forma de devolver
 * "cero" sin dejar escrito el motivo, que es lo que hacía imposible el
 * diagnóstico del 2026-11-10.
 */
function sinEnviosPorque(razon: string): ResultadoFcm {
  return { enviados: 0, fallidos: 0, muertos: [], razones: [razon] };
}

function combinar(android: ResultadoFcm, ios: ResultadoApns): ResultadoFcm {
  return {
    enviados: android.enviados + ios.enviados,
    fallidos: android.fallidos + ios.fallidos,
    muertos: [...android.muertos, ...ios.muertos],
    razones: [...android.razones, ...ios.razones],
  };
}

/**
 * Avisa a los teléfonos de una persona, Android por FCM e iOS por APNs.
 *
 * Sin ninguna de las dos configuradas no consulta nada y no envía nada. Los
 * tokens que cada servicio da por muertos se borran de `dispositivos_push`,
 * para no volver a intentar contra un teléfono que ya no tiene la app. Nunca
 * lanza error: el aviso por otros canales no puede caerse por esto.
 *
 * CADA SALIDA EN CERO DEJA UN RASTRO. El 2026-11-10 esta función devolvió
 * "cero enviados, cero fallidos" para dos cuentas CON dispositivo registrado,
 * y no había forma de saber por cuál de sus cinco salidas se fue: todas eran
 * mudas. Un canal apagado y un canal roto se veían exactamente igual.
 *
 * LOS DOS CANALES VAN POR SEPARADO (`allSettled`, no `all`). Antes, una
 * excepción de FCM —`tokenDeAcceso` lanza si Google rechaza la cuenta de
 * servicio— se llevaba puesto el envío a los iPhone de la misma persona, que
 * no tienen nada que ver con Firebase.
 */
export async function avisarNativo(
  admin: ClienteSinTipos,
  usuarioId: string,
  aviso: AvisoNativo,
): Promise<ResultadoFcm> {
  const hayFcm = Boolean(cuentaDeServicio());
  const hayApns = Boolean(claveApns());

  if (!hayFcm && !hayApns) {
    console.error("Push nativo: no hay NI cuenta de servicio de FCM NI clave de APNs; no se envía nada.");
    return sinEnviosPorque("no hay NI cuenta de servicio de FCM NI clave de APNs");
  }

  try {
    const { data, error } = await admin
      .from("dispositivos_push")
      .select("plataforma, token")
      .eq("usuario_id", usuarioId);

    if (error) {
      console.error(`Push nativo: no se pudo leer dispositivos_push de ${usuarioId}:`, error);
      return sinEnviosPorque(
        `no se pudo leer dispositivos_push: ${String((error as { message?: string }).message ?? error)}`,
      );
    }
    if (!data || data.length === 0) {
      console.error(`Push nativo: ${usuarioId} no tiene ningún dispositivo registrado.`);
      return sinEnviosPorque("esta cuenta no tiene ningún dispositivo registrado");
    }

    const dispositivos = data as { plataforma: "android" | "ios"; token: string }[];
    const tokensAndroid = dispositivos.filter((d) => d.plataforma === "android").map((d) => d.token);
    const tokensIos = dispositivos.filter((d) => d.plataforma === "ios").map((d) => d.token);

    // Un teléfono cuyo canal no está configurado no es un fallo del otro: se
    // dice y se sigue. Es la diferencia entre "no llegó" y "no se intentó".
    if (tokensIos.length > 0 && !hayApns) {
      console.error(`Push nativo: ${usuarioId} tiene ${tokensIos.length} iPhone(s) pero falta la clave de APNs.`);
    }
    if (tokensAndroid.length > 0 && !hayFcm) {
      console.error(`Push nativo: ${usuarioId} tiene ${tokensAndroid.length} Android pero falta la cuenta de FCM.`);
    }

    const [android, ios] = await Promise.allSettled([
      enviarFcm(tokensAndroid, aviso),
      enviarApns(tokensIos, aviso),
    ]);

    if (android.status === "rejected") {
      console.error(`Push nativo: FCM lanzó para ${usuarioId}:`, android.reason);
    }
    if (ios.status === "rejected") {
      console.error(`Push nativo: APNs lanzó para ${usuarioId}:`, ios.reason);
    }

    const resultado = combinar(
      android.status === "fulfilled" ? android.value : sinEnviosPorque(`FCM lanzó: ${String(android.reason)}`),
      ios.status === "fulfilled" ? ios.value : sinEnviosPorque(`APNs lanzó: ${String(ios.reason)}`),
    );

    if (resultado.muertos.length > 0) {
      console.error(`Push nativo: ${resultado.muertos.length} token(s) de ${usuarioId} dados por muertos; se borran.`);
      await admin.from("dispositivos_push").delete().in("token", resultado.muertos);
    }
    return resultado;
  } catch (error) {
    console.error(`Push nativo: excepción avisando a ${usuarioId}:`, error);
    return sinEnviosPorque(`excepción: ${(error as Error).message}`);
  }
}
