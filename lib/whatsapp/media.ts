import { normalizarArchivo, type ArchivoEOS } from "@/lib/eos/procesar-mensaje";

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

    const buffer = Buffer.from(await archivoResp.arrayBuffer());

    return normalizarArchivo({
      nombre: nombreSugerido,
      tipo: meta.mime_type || mimeType,
      base64: buffer.toString("base64"),
      tamanio: buffer.length,
    });
  } catch (error) {
    console.error("WhatsApp: error descargando un adjunto:", error);
    return null;
  }
}
