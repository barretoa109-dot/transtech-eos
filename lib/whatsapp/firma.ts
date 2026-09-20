import { createHmac, timingSafeEqual } from "crypto";

/**
 * ¿Este POST lo mandó Meta de verdad?
 *
 * El webhook de WhatsApp es una URL pública: cualquiera que la conozca puede
 * mandarle un POST con un `usuario_id` inventado y hacer que EOS ejecute
 * acciones en su nombre. La firma es lo único que distingue "esto lo mandó
 * Meta" de "esto lo mandó cualquiera" — por eso se calcula sobre el cuerpo
 * CRUDO (antes de `JSON.parse`, que puede reordenar o normalizar bytes) y se
 * compara en tiempo constante, mismo patrón que
 * `lib/seguridad/worker-bearer.ts` usa para el secreto del Worker.
 */
export function firmaWhatsappValida(
  cuerpoCrudo: string,
  firmaHeader: string | null,
  /**
   * El secreto de la app de Meta de UN canal de empresa (v185), si lo tiene. Cuando
   * viene, es el ÚNICO que vale —no se cae al global—: un canal con app propia no
   * acepta lo que firmó otra. Ver `lib/whatsapp-crm/firma-canal.ts`.
   */
  secretoDeCanal?: string | null,
): boolean {
  const secreto = secretoDeCanal || process.env.WHATSAPP_APP_SECRET;
  if (!secreto || !firmaHeader) return false;

  const esperada =
    "sha256=" + createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest("hex");

  const esperadaBuffer = Buffer.from(esperada);
  const recibidaBuffer = Buffer.from(firmaHeader);

  if (esperadaBuffer.length !== recibidaBuffer.length) {
    return false;
  }

  return timingSafeEqual(esperadaBuffer, recibidaBuffer);
}
