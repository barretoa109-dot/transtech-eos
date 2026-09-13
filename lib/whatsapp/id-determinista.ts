import { createHash } from "crypto";

/**
 * Un UUID propio, no un registrado: no hace falta que sea de nadie más, solo
 * que sea siempre el mismo para esta app.
 */
const NAMESPACE = Buffer.from("6f1c9c2e6d1a4e9d9a1b2f6a5b8f7c11", "hex");

/**
 * Convierte un identificador de WhatsApp (`wamid...`) en un UUID estable —
 * mismo texto de entrada, mismo UUID de salida, siempre.
 *
 * Hace falta porque `eos_reserve_message_quota_server_v75` usa `request_id`
 * como su clave de "exact-once": si Meta reintrega el mismo webhook —pasa
 * seguido, sobre todo si tardamos en responder 200— dos `crypto.randomUUID()`
 * distintos harían que el mismo mensaje de WhatsApp se cobre y se procese dos
 * veces. Con un id determinístico, el segundo intento cae en el mismo
 * `request_id` y la reserva lo trata como el mismo pedido.
 */
export function idDeterministico(semilla: string): string {
  const hash = createHash("sha1")
    .update(NAMESPACE)
    .update(Buffer.from(semilla, "utf8"))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // versión 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
