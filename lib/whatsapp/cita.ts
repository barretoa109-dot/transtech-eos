/**
 * "Responder" en WhatsApp: el mensaje citado tiene que llegarle a EOS.
 *
 * ============================================================
 * EL CASO (29/09/2026)
 * ============================================================
 *
 * Sofía citó una respuesta de EOS que decía "USD 12,37 × 6.014,85 = ₲74.404"
 * y escribió "Agregale el costo de envío a zapatos marrón mocha". EOS le pidió
 * el tipo de cambio. Lo volvió a citar con "Aquí está", y EOS contestó "No me
 * llegó el dato". Tenía razón: Meta manda solo el id del mensaje citado
 * (`context.id`), nunca su texto, y el webhook lo tiraba. Al modelo le llegaba
 * "Aquí está" y nada más. Ningún modelo contesta bien eso.
 *
 * ============================================================
 * CÓMO VIAJA
 * ============================================================
 *
 * Adentro del mensaje, con "> " adelante, igual que la cita de la web
 * (`textoConCita`, en `lib/eos/cita.ts`). Así llega por los dos gateways
 * —n8n no lee el campo `cita`— y queda en el historial: el turno siguiente
 * también sabe a qué se refería.
 *
 * NO va por el campo `cita`: ése le dice al modelo "te preguntan sobre este
 * pedazo, explicá la cuenta, no la rehagas". Acá es al revés: la persona usa
 * el dato citado para pedir algo nuevo.
 */

import { limpiarSeleccion } from "../eos/cita.ts";

export type Citado =
  /** El mensaje citado, encontrado entre los guardados. */
  | { rol: "eos" | "usuario"; texto: string }
  /** Citó algo, pero no está guardado (un aviso automático, algo muy viejo). */
  | "no-encontrado"
  /** No citó nada. */
  | null;

export function mensajeConCitaDeWhatsapp(mensaje: string, citado: Citado): string {
  if (citado === null) return mensaje;

  if (citado === "no-encontrado") {
    // Que el modelo sepa que hubo una cita que no ve: sin esto, pide un dato
    // que la persona cree haber mostrado ("no me llegó el dato").
    return `(Responde a un mensaje anterior que no tengo guardado. Si hace falta un dato de ese mensaje, pedile que lo escriba.)\n\n${mensaje}`.trim();
  }

  const texto = limpiarSeleccion(citado.texto);
  if (!texto) return mensaje;

  const quien = citado.rol === "eos" ? "En respuesta a este mensaje de EOS:" : "En respuesta a su propio mensaje anterior:";
  const lineas = texto
    .split("\n")
    .map((linea) => `> ${linea}`)
    .join("\n");

  return `${quien}\n${lineas}\n\n${mensaje}`.trim();
}
