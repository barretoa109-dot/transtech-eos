/**
 * El WhatsApp de EOS: el número al que la gente le escribe.
 *
 * ============================================================
 * POR QUÉ ESTÁ ESCRITO ACÁ Y NO SOLO EN UNA VARIABLE DE ENTORNO
 * ============================================================
 *
 * El perfil mostraba el número leyendo `WHATSAPP_DISPLAY_NUMBER` a través de
 * `/api/whatsapp/vincular`, y dibujaba la fila SOLO si esa llamada devolvía algo.
 * Si la variable no estaba cargada en el entorno de producción, o la llamada
 * fallaba, la fila desaparecía sin ningún aviso — y la persona se quedaba sin
 * saber a qué número escribirle a EOS, que es justo lo que esa fila existe para
 * decir.
 *
 * El número de EOS es público (es el que se le da a los clientes) y no cambia
 * con cada despliegue, así que vive acá como valor por defecto. La variable de
 * entorno sigue pudiendo cambiarlo —si algún día se migra de número— sin tocar
 * código, pero su ausencia ya no esconde nada.
 */
export const NUMERO_WHATSAPP_EOS = "+595 987 506802";

/** El número que se muestra: el de la variable de entorno si está, y si no el de siempre. */
export function numeroWhatsappEOS(desdeEntorno?: string | null): string {
  const limpio = String(desdeEntorno ?? "").trim();
  return limpio || NUMERO_WHATSAPP_EOS;
}

/**
 * El enlace que abre la conversación con EOS: `wa.me` solo admite dígitos, sin
 * "+", espacios ni guiones.
 */
export function enlaceWhatsappEOS(numero: string = NUMERO_WHATSAPP_EOS): string {
  return `https://wa.me/${numero.replace(/[^\d]/g, "")}`;
}
