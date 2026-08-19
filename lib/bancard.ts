import crypto from "crypto";

/*
 * Cliente de Bancard vPOS 2.0 (Compra Simple, spec v1.23).
 *
 * Cubre el flujo tokenizado (catastro + charge), que es el que permite
 * cobrar renovaciones sin intervención del usuario: se catastra la
 * tarjeta una vez con el iframe de Bancard, y después cada cobro es
 * backend-to-backend (users_cards para obtener un alias_token fresco,
 * luego charge).
 *
 * Bancard nunca nos entrega el número de tarjeta: el formulario vive en
 * su propio iframe (PCI). Nosotros sólo guardamos identificadores.
 */

const ENVIRONMENTS = {
  production: "https://vpos.infonet.com.py",
  staging: "https://vpos.infonet.com.py:8888",
} as const;

function limpiarVariable(nombre: string, valor: string | undefined) {
  if (!valor) {
    throw new Error(`${nombre} no configurado.`);
  }

  return valor.trim().replace(/^["']|["']$/g, "");
}

export function getBancardKeys() {
  return {
    publicKey: limpiarVariable("BANCARD_PUBLIC_KEY", process.env.BANCARD_PUBLIC_KEY),
    privateKey: limpiarVariable(
      "BANCARD_PRIVATE_KEY",
      process.env.BANCARD_PRIVATE_KEY,
    ),
  };
}

export function getBancardBaseUrl() {
  const entorno = (process.env.BANCARD_ENV || "staging").trim().toLowerCase();

  return entorno === "production" ? ENVIRONMENTS.production : ENVIRONMENTS.staging;
}

export function esProduccionBancard() {
  return getBancardBaseUrl() === ENVIRONMENTS.production;
}

function md5(texto: string) {
  return crypto.createHash("md5").update(texto, "utf8").digest("hex");
}

/*
 * Bancard exige el monto como cadena con exactamente dos decimales y
 * punto como separador, tanto en el token como en el cuerpo. Si el token
 * y el body no coinciden carácter por carácter, la firma se rechaza.
 */
export function formatearMontoBancard(monto: number | string) {
  const numero = typeof monto === "number" ? monto : Number.parseFloat(monto);

  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error("El monto para Bancard no es válido.");
  }

  return numero.toFixed(2);
}

export function tokenSingleBuy(
  privateKey: string,
  shopProcessId: number | string,
  monto: number | string,
  moneda = "PYG",
) {
  return md5(
    `${privateKey}${shopProcessId}${formatearMontoBancard(monto)}${moneda}`,
  );
}

export function tokenCatastro(
  privateKey: string,
  cardId: number | string,
  userId: number | string,
) {
  return md5(`${privateKey}${cardId}${userId}request_new_card`);
}

export function tokenListarTarjetas(
  privateKey: string,
  userId: number | string,
) {
  return md5(`${privateKey}${userId}request_user_cards`);
}

export function tokenCharge(
  privateKey: string,
  shopProcessId: number | string,
  monto: number | string,
  aliasToken: string,
  moneda = "PYG",
) {
  return md5(
    `${privateKey}${shopProcessId}charge${formatearMontoBancard(monto)}${moneda}${aliasToken}`,
  );
}

export function tokenEliminarTarjeta(
  privateKey: string,
  userId: number | string,
  cardToken: string,
) {
  return md5(`${privateKey}delete_card${userId}${cardToken}`);
}

export function tokenConsultaConfirmacion(
  privateKey: string,
  shopProcessId: number | string,
) {
  return md5(`${privateKey}${shopProcessId}get_confirmation`);
}

export function tokenRollback(
  privateKey: string,
  shopProcessId: number | string,
) {
  return md5(`${privateKey}${shopProcessId}rollback0.00`);
}

/*
 * Token con el que Bancard firma el POST de confirmación que nos envía.
 * Lo recalculamos para verificar que la notificación viene realmente de
 * Bancard y no de un tercero que conoce nuestra URL de confirmación.
 */
export function tokenConfirmacionEsperado(
  privateKey: string,
  shopProcessId: number | string,
  monto: number | string,
  moneda = "PYG",
) {
  return md5(
    `${privateKey}${shopProcessId}confirm${formatearMontoBancard(monto)}${moneda}`,
  );
}

type RespuestaBancard = {
  ok: boolean;
  status: number;
  data: any;
};

export async function llamarBancard(
  path: string,
  body: Record<string, unknown>,
  metodo: "POST" | "DELETE" = "POST",
): Promise<RespuestaBancard> {
  const url = `${getBancardBaseUrl()}${path}`;

  const response = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const texto = await response.text();

  let data: any = null;

  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    data = { status: "error", raw: texto.slice(0, 500) };
  }

  return {
    ok: response.ok && data?.status === "success",
    status: response.status,
    data,
  };
}

/*
 * Bancard devuelve los errores dentro de messages[].dsc, que suele traer
 * detalle técnico (validaciones, nombres de campo). No exponerlo tal cual
 * al usuario final.
 */
export function describirErrorBancard(data: any) {
  const mensajes = Array.isArray(data?.messages) ? data.messages : [];
  const primero = mensajes[0] || {};

  return {
    key: typeof primero.key === "string" ? primero.key : "UnknownError",
    detalle: typeof primero.dsc === "string" ? primero.dsc : "",
  };
}
