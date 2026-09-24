import { createHash } from "node:crypto";

/*
 * El freno de ráfaga del chat, por usuario.
 *
 * El cupo del plan cuenta mensajes por día (Free) o por mes (pagos), y el plan
 * Business no tiene tope. Nada impedía que un script con la sesión de alguien
 * —o un bucle en un cliente roto— mandara cientos de mensajes por minuto: cada
 * uno es una llamada al modelo que paga TransTech, y en un plan sin tope la
 * cuenta no se cierra nunca.
 *
 * Una persona escribiendo no llega a 20 mensajes por minuto ni a 300 por hora.
 * Por encima de eso, esperar un rato no le cuesta nada a nadie.
 *
 * Falla ABIERTO, a diferencia del código de WhatsApp: esto protege plata, no
 * cuentas. Si el contador no responde, cortar el chat de todos sería peor que
 * dejar pasar unos mensajes de más.
 */
export const RAFAGAS = [
  { ventanaSegundos: 60, maximo: 20 },
  { ventanaSegundos: 3600, maximo: 300 },
] as const;

type ClienteAdmin = {
  rpc: (
    nombre: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type Rafaga = { permitido: boolean; faltanSegundos: number };

export async function dentroDeRafaga(
  admin: ClienteAdmin,
  usuarioId: string,
  secreto: string | undefined,
): Promise<Rafaga> {
  if (!secreto || secreto.length < 16) return { permitido: true, faltanSegundos: 0 };

  for (const { ventanaSegundos, maximo } of RAFAGAS) {
    const clave = createHash("sha256")
      .update(`${secreto}chat-rafaga-${ventanaSegundos}${usuarioId}`)
      .digest("hex");

    try {
      const { data, error } = await admin.rpc("eos_consumir_cupo_v99", {
        p_clave: clave,
        p_ventana_segundos: ventanaSegundos,
        p_maximo: maximo,
      });
      if (error) {
        console.error("Ráfaga: no se pudo consultar el contador:", error.message);
        continue;
      }
      const cupo = data as { permitido?: boolean; faltan_segundos?: number } | null;
      if (cupo?.permitido === false) {
        return { permitido: false, faltanSegundos: Number(cupo.faltan_segundos ?? ventanaSegundos) };
      }
    } catch (fallo) {
      console.error("Ráfaga: excepción consultando el contador:", fallo);
    }
  }

  return { permitido: true, faltanSegundos: 0 };
}
