import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token del enlace de baja de los correos que EOS manda por su cuenta.
 *
 * El enlace se abre desde el correo, sin sesión: la persona puede estar en el
 * celular, en otra cuenta del navegador o sin haber iniciado nunca. Lo que lo
 * protege es que el token es un HMAC del id de usuario con un secreto del
 * servidor — nadie puede darle de baja a otro sin conocer el secreto, y un id
 * que se adivinara no alcanza.
 *
 * Es determinístico a propósito (no vence ni se guarda): la baja de un correo
 * que llegó hace tres meses tiene que seguir funcionando, y una baja repetida
 * es inofensiva.
 *
 * El `motivo` separa las familias: el token de baja de los motivacionales no
 * sirve para nada más el día que haya otro tipo de correo con su propia baja.
 */
export function crearTokenBaja(usuarioId: string, motivo: string, secreto: string): string {
  return createHmac("sha256", secreto).update(`${motivo}:${usuarioId}`).digest("hex");
}

export function tokenDeBajaValido(
  usuarioId: string,
  motivo: string,
  token: string,
  secreto: string,
): boolean {
  if (!usuarioId || !token || !secreto) return false;

  const esperado = Buffer.from(crearTokenBaja(usuarioId, motivo, secreto));
  const recibido = Buffer.from(token);
  if (esperado.length !== recibido.length) return false;

  return timingSafeEqual(esperado, recibido);
}
