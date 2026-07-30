import crypto from "crypto";

export const PAGOPAR_API =
  "https://api.pagopar.com/api";

function limpiarVariable(
  nombre: string,
  valor: string | undefined,
) {
  if (!valor) {
    throw new Error(`${nombre} no configurado.`);
  }

  return valor
    .trim()
    .replace(/^["']|["']$/g, "");
}

export function getPagoparKeys() {
  const publicKey = limpiarVariable(
    "PAGOPAR_PUBLIC_KEY",
    process.env.PAGOPAR_PUBLIC_KEY,
  );

  const privateKey = limpiarVariable(
    "PAGOPAR_PRIVATE_KEY",
    process.env.PAGOPAR_PRIVATE_KEY,
  );

  return {
    publicKey,
    privateKey,
  };
}

export function sha1(texto: string) {
  return crypto
    .createHash("sha1")
    .update(texto, "utf8")
    .digest("hex");
}

export function normalizarMontoPagopar(
  monto: number | string,
) {
  const numero = Number.parseFloat(String(monto));

  if (!Number.isFinite(numero)) {
    throw new Error(
      "El monto utilizado para PagoPar no es válido.",
    );
  }

  /*
   * Equivalente en JavaScript a:
   * strval(floatval($monto_total))
   */
  return String(numero);
}

export function tokenPedido(
  privateKey: string,
  idPedido: string,
  monto: number | string,
) {
  const montoNormalizado =
    normalizarMontoPagopar(monto);

  return sha1(
    `${privateKey}${idPedido}${montoNormalizado}`,
  );
}

export function tokenWebhook(
  privateKey: string,
  hashPedido: string,
) {
  return sha1(
    `${privateKey}${hashPedido}`,
  );
}

export function tokenConsulta(
  privateKey: string,
) {
  return sha1(
    `${privateKey}CONSULTA`,
  );
}

export function checkoutURL(
  hashPedido: string,
) {
  return `https://www.pagopar.com/pagos/${encodeURIComponent(
    hashPedido,
  )}`;
}