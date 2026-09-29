/**
 * Cómo le llega a la persona la respuesta de un mensaje que quedó en espera.
 *
 * Aparte de `en-espera.ts` porque esto sí sale a la red (WhatsApp, push) y
 * aquella lógica se prueba sin nada de eso.
 *
 *  - Siempre queda en su conversación, como mensaje de EOS: es lo que ve al
 *    volver a abrir el chat.
 *  - Si escribió por WhatsApp, se le manda por WhatsApp al número vinculado.
 *    Pasa dentro de la hora, así que la ventana de 24 horas de Meta está
 *    abierta: fue la persona la que escribió último.
 *  - Si escribió en la app o en la web, un aviso push a sus dispositivos.
 */

import { enviarTexto } from "../whatsapp/enviar.ts";
import { enviarAviso, pushConfigurado, resumirParaPush, type Suscripcion } from "../push/enviar.ts";
import type { ClienteEnEspera, FilaEnEspera } from "./en-espera.ts";

export function entregaEnEspera(admin: ClienteEnEspera) {
  return async (fila: FilaEnEspera, texto: string): Promise<boolean> => {
    let llego = false;

    if (fila.conversacion_id) {
      const { error } = await admin.from("mensajes").insert([
        {
          conversacion_id: fila.conversacion_id,
          usuario_id: fila.usuario_id,
          rol: "eos",
          texto,
          origen: fila.origen,
        },
      ]);
      if (error) console.error("En espera: no se pudo guardar la respuesta en el chat:", error);
      else llego = true;
    }

    if (fila.origen === "whatsapp") {
      const { data: vinculo } = await admin
        .from("eos_whatsapp_vinculos_v162")
        .select("telefono")
        .eq("usuario_id", fila.usuario_id)
        .not("verificado_at", "is", null)
        .maybeSingle();
      const telefono = typeof vinculo?.telefono === "string" ? vinculo.telefono : "";
      if (telefono && (await enviarTexto(telefono, texto))) llego = true;
      return llego;
    }

    if (pushConfigurado()) {
      const { data } = await admin
        .from("eos_push_suscripciones")
        .select("id,endpoint,p256dh,auth")
        .eq("usuario_id", fila.usuario_id)
        .eq("activa", true);
      const suscripciones = (data ?? []) as Suscripcion[];
      if (suscripciones.length > 0) {
        const resultado = await enviarAviso(suscripciones, {
          titulo: "EOS",
          cuerpo: resumirParaPush(texto, 160),
          url: "/eos/chat",
          tag: "eos-en-espera",
        });
        if (resultado.enviados > 0) llego = true;
      }
    }

    return llego;
  };
}
