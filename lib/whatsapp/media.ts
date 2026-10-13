import { normalizarArchivo, type ArchivoEOS } from "../eos/procesar-mensaje.ts";
import { achicarImagen } from "./achicar.ts";
import { descargarBytes } from "./descargar-bytes.ts";

export { descargarBytes };

/**
 * Descarga un adjunto de WhatsApp y lo deja en la misma forma que ya usa el
 * resto de EOS (`ArchivoEOS`, base64) — así entra al motor de mensajes sin
 * que nadie tenga que enseñarle un formato nuevo.
 *
 * WhatsApp no manda el archivo en el webhook, manda un `media id`. Hace falta
 * un primer pedido para resolver la URL temporal de descarga, y un segundo
 * para bajarlo — los dos autenticados con el mismo token.
 *
 * Devuelve `null` ante cualquier problema (red, tipo no permitido, tamaño):
 * quien llama sigue con el mensaje de texto que haya, si lo hay.
 */
export async function descargarMedia(
  mediaId: string,
  mimeType: string,
  nombreSugerido: string,
): Promise<ArchivoEOS | null> {
  const bajado = await descargarBytes(mediaId, mimeType);
  if (!bajado) return null;

  // Las fotos, al tamaño que el modelo aprovecha (ver `achicar.ts`).
  const archivo = bajado.tipo.startsWith("image/") ? await achicarImagen(bajado.bytes, bajado.tipo) : bajado;

  try {
    return normalizarArchivo({
      // Si se pasó a JPEG, el nombre lo dice: el tipo y la extensión no se contradicen.
      nombre: "achicada" in archivo && archivo.achicada ? nombreSugerido.replace(/\.[a-z0-9]+$/i, "") + ".jpg" : nombreSugerido,
      tipo: archivo.tipo,
      base64: archivo.bytes.toString("base64"),
      tamanio: archivo.bytes.length,
    });
  } catch (error) {
    console.error("WhatsApp: el adjunto no se pudo usar:", error);
    return null;
  }
}
