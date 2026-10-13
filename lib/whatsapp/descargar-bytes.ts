/**
 * Los bytes de un adjunto de WhatsApp, tal cual llegan. Aparte de `media.ts`
 * a propósito: esto no importa nada del runtime de Next.js (`media.ts` sí,
 * por `normalizarArchivo`), así que cualquier módulo que sólo necesite bajar
 * bytes —como `video.ts` o un lector de comprobantes— puede importarlo sin
 * arrastrar `next/server` ni las rutas de `app/api` a un `node --test`.
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

  const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

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
