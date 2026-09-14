const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/** Límite real de WhatsApp Cloud API para el cuerpo de un mensaje de texto. */
const MAX_TEXTO = 4096;

/**
 * Manda un mensaje de texto por WhatsApp Cloud API.
 *
 * Devuelve `false` en vez de lanzar: quien llama ya generó la respuesta de
 * EOS, y una excepción acá no debería tirar abajo el resto del procesamiento
 * del webhook (que responde `200` a Meta pase lo que pase, para que no
 * reintente el mensaje entero).
 */
export async function enviarTexto(telefono: string, texto: string): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error("WhatsApp: faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.");
    return false;
  }

  try {
    const respuesta = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: telefono,
          type: "text",
          text: { body: texto.slice(0, MAX_TEXTO), preview_url: false },
        }),
      },
    );

    if (!respuesta.ok) {
      console.error("WhatsApp: el envío de mensaje falló con status", respuesta.status);
      return false;
    }

    return true;
  } catch (error) {
    console.error("WhatsApp: error de red al enviar un mensaje:", error);
    return false;
  }
}

/**
 * Manda un archivo por WhatsApp Cloud API.
 *
 * Son dos pedidos, no uno: primero se sube el archivo a `/media` —Meta lo
 * guarda un rato y devuelve un `id`—, y recién con ese `id` se manda el
 * mensaje. No se usa la variante `link` (pasarle una URL para que Meta la
 * baje sola) porque la URL de descarga de EOS exige sesión — Meta, que la
 * pide sin ninguna, se encontraría con un 401. Subir los bytes de una la
 * evita del todo.
 */
export async function enviarDocumento(
  telefono: string,
  bytes: Buffer,
  nombre: string,
  tipo: string,
): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error("WhatsApp: faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.");
    return false;
  }

  try {
    const formulario = new FormData();
    formulario.append("messaging_product", "whatsapp");
    formulario.append("type", tipo);
    formulario.append("file", new Blob([new Uint8Array(bytes)], { type: tipo }), nombre);

    const subida = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formulario,
    });

    if (!subida.ok) {
      console.error("WhatsApp: no se pudo subir el archivo, status", subida.status);
      return false;
    }

    const cuerpoSubida = (await subida.json()) as { id?: string };
    if (!cuerpoSubida.id) {
      console.error("WhatsApp: la subida del archivo no devolvió un id.");
      return false;
    }

    const envio = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefono,
        type: "document",
        document: { id: cuerpoSubida.id, filename: nombre },
      }),
    });

    if (!envio.ok) {
      console.error("WhatsApp: el envío del documento falló con status", envio.status);
      return false;
    }

    return true;
  } catch (error) {
    console.error("WhatsApp: error de red al enviar un documento:", error);
    return false;
  }
}
