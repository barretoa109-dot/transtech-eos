import { adminSinTipos } from "../supabase/sin-tipos.ts";
import { avisarUsoAlto, baseUrlDeLaApp } from "../monitoreo/uso-alto.ts";

/**
 * Suma al consumo del mes lo que cuestan las llamadas al modelo que no son el
 * mensaje: la lectura de imágenes, los audios y el clasificador de WhatsApp
 * del CRM (v202). Sin esto, el aviso interno de los Gs. 70.000 llegaba tarde en
 * las cuentas que mandan muchas fotos o audios.
 *
 * Con `avisar`, después de sumar revisa si la cuenta pasó el umbral. Lo usa el
 * webhook del CRM; el mensaje de EOS ya lo revisa en `procesar-mensaje.ts`.
 *
 * Nunca lanza: registrar el costo no puede tumbar lo que ya se le respondió a
 * nadie.
 */
export async function sumarCostoIA(
  usuarioId: string,
  costoUsd: number,
  opciones: { avisar?: boolean } = {},
): Promise<void> {
  if (!usuarioId || !Number.isFinite(costoUsd) || costoUsd <= 0) return;

  try {
    const { error } = await adminSinTipos().rpc("eos_sumar_costo_ia_v202", {
      p_usuario_id: usuarioId,
      p_costo_usd: Math.round(costoUsd * 1_000_000) / 1_000_000,
    });
    if (error) throw new Error(error.message);

    if (opciones.avisar) await avisarUsoAlto(baseUrlDeLaApp(), usuarioId);
  } catch (error) {
    console.error("Costo IA: no se pudo sumar al consumo del mes:", error);
  }
}
