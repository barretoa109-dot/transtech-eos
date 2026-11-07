import { descargarBytes } from "../whatsapp/descargar-bytes.ts";
import { transcribirAudio } from "../eos/transcribir-audio.ts";

/**
 * Un audio que un CLIENTE le mandó al WhatsApp de la empresa, transcripto.
 *
 * El canal del dueño (`lib/eos/procesar-mensaje.ts`) ya transcribe cualquier
 * audio que le llega a EOS desde hace tiempo. Este canal —cuando un cliente le
 * escribe al WhatsApp de la empresa, no al de EOS— nunca lo hacía: un audio
 * llegaba con `texto` vacío, y `clasificarIntencion("")` siempre contesta
 * "otro", pase lo que pase en el audio. Un cliente que pide de baja, que
 * confirma una compra o que pregunta un precio por voz quedaba sin clasificar
 * — y lo más grave de los tres es la baja: si no se detecta, se le sigue
 * escribiendo a alguien que pidió que no le escriban más.
 *
 * Mismo criterio que `transcribirAudio`: si algo falla (sin `OPENAI_API_KEY`,
 * de red, Whisper no entendió nada), se devuelve `null` y quien llama sigue
 * con el mensaje vacío de siempre — un audio sin transcribir no es peor que
 * lo que ya pasaba antes de este cambio.
 */
export async function transcribirAudioDeCliente(
  mediaId: string,
  mimeType: string,
  opciones: { alCosto?: (usd: number) => void } = {},
): Promise<string | null> {
  if (!mediaId) return null;

  const bajado = await descargarBytes(mediaId, mimeType);
  if (!bajado) return null;

  return transcribirAudio(
    { nombre: "audio-whatsapp-cliente", tipo: bajado.tipo, base64: bajado.bytes.toString("base64") },
    opciones,
  );
}
