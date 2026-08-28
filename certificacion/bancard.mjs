/**
 * Lo mínimo de Bancard que la certificación necesita.
 *
 * No reutiliza `lib/bancard.ts` a propósito: ese módulo es TypeScript con alias
 * de Next (`@/...`) y no se puede importar desde un script suelto sin arrastrar
 * medio compilador. Son cuatro funciones de una línea.
 *
 * Lo que sí importa es que las fórmulas de token sean IDÉNTICAS a las de la
 * aplicación. Si algún día divergen, la certificación pasaría con una fórmula
 * que la app no usa — que es la peor clase de prueba: la que da tranquilidad
 * sin mirar lo que hay que mirar. Ver `lib/bancard.ts`.
 */

import crypto from "node:crypto";
import { CONFIG } from "./entorno.mjs";

const md5 = (texto) => crypto.createHash("md5").update(texto).digest("hex");

/** Bancard exige dos decimales siempre, incluso en guaraníes. */
export const montoBancard = (n) => Number(n).toFixed(2);

export const tokenListarTarjetas = (userId) =>
  md5(`${CONFIG.bancardPrivada}${userId}request_user_cards`);

export const tokenCobro = (shopProcessId, monto, aliasToken, moneda = "PYG") =>
  md5(
    `${CONFIG.bancardPrivada}${shopProcessId}charge${montoBancard(monto)}${moneda}${aliasToken}`,
  );

export async function llamar(ruta, operation) {
  const respuesta = await fetch(CONFIG.bancardBase + ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: CONFIG.bancardPublica, operation }),
  });

  const datos = await respuesta.json().catch(() => ({}));

  return { http: respuesta.status, datos };
}

/** Las tarjetas que Bancard tiene para ese usuario, con su alias fresco. */
export async function tarjetasDe(bancardUserId) {
  const { datos } = await llamar(`/users/${bancardUserId}/cards`, {
    token: tokenListarTarjetas(bancardUserId),
  });

  return Array.isArray(datos.cards) ? datos.cards : [];
}

/**
 * Cobra, y devuelve la operación tal cual la contesta Bancard.
 *
 * `charge` responde bajo `confirmation` y no bajo `operation` como sugiere la
 * especificación; se contemplan las dos formas, igual que en la aplicación.
 */
export async function cobrar({ shopProcessId, monto, aliasToken, descripcion }) {
  const m = montoBancard(monto);

  const { datos } = await llamar("/charge", {
    token: tokenCobro(shopProcessId, m, aliasToken),
    shop_process_id: shopProcessId,
    amount: m,
    currency: "PYG",
    number_of_payments: 1,
    additional_data: "",
    description: String(descripcion || "EOS").slice(0, 20),
    alias_token: aliasToken,
    return_url: `${CONFIG.sitio}/pago/resultado?ref=${shopProcessId}`,
    extra_response_attributes: ["confirmation.process_id"],
  });

  const operacion = datos.confirmation || datos.operation;

  if (operacion) return operacion;

  /*
   * Sin `confirmation` ni `operation`, Bancard rechazó a nivel de API. El
   * motivo viaja en `messages` y hay que conservarlo: sin él, quien lea la
   * salida de la suite ve "no se aprobó" y no sabe si la tarjeta dijo que no o
   * si le mandamos mal el monto.
   */
  return { _error: datos?.messages?.[0]?.key ?? "sin_respuesta", _crudo: datos };
}

/**
 * El sandbox de Bancard bloquea el mismo importe sobre la misma tarjeta
 * durante cinco minutos. No es un defecto del producto: es una protección de la
 * pasarela contra el doble cobro, y en producción protege a los usuarios.
 *
 * Importa distinguirlo porque una suite que se pone roja por esto enseña a
 * ignorar el rojo, y una que lo da por bueno deja de probar el pago sin avisar.
 */
export const esCobroRepetido = (operacion) =>
  operacion?._error === "DuplicatePaymentError";

export const aprobada = (operacion) =>
  operacion?.response === "S" && String(operacion?.response_code) === "00";
