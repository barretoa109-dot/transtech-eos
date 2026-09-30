import { normalizarArchivo, type ArchivoEOS } from "@/lib/eos/procesar-mensaje";
import { achicarImagen } from "@/lib/whatsapp/achicar";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

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

/**
 * Los bytes de un adjunto, tal cual llegan. Lo usa `descargarMedia` y, para
 * los videos —que no viajan como archivo sino desarmados—,
 * `lib/whatsapp/video.ts`.
 */
export async function descargarBytes(
  mediaId: string,
  mimeType: string,
): Promise<{ bytes: Buffer; tipo: string } | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !mediaId) {
    console.error("WhatsApp: falta WHATSAPP_ACCESS_TOKEN o el id del adjunto.");
    return null;
  }

  try {
    const metaResp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!metaResp.ok) {
      console.error("WhatsApp: no se pudo resolver la URL del adjunto,", metaResp.status);
      return null;
    }

    const meta = (await metaResp.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const archivoResp = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!archivoResp.ok) {
      console.error("WhatsApp: no se pudo descargar el adjunto,", archivoResp.status);
      return null;
    }

    return {
      bytes: Buffer.from(await archivoResp.arrayBuffer()),
      tipo: meta.mime_type || mimeType,
    };
  } catch (error) {
    console.error("WhatsApp: error descargando un adjunto:", error);
    return null;
  }
}
