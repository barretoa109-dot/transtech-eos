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
