import { createHash, randomBytes } from "node:crypto";

/**
 * Las claves de API del Developer Platform (ítem 25, primera pieza, solo
 * lectura). Ver `docs/arquitectura-developer-platform-2026-11-07.md`.
 *
 * Nunca se guarda la clave en texto plano — se guarda su hash SHA-256, y el
 * valor real se muestra UNA sola vez, al crearla, igual que cualquier
 * proveedor serio (Stripe, OpenAI). El prefijo (los primeros caracteres,
 * SIN el secreto) sirve para que la persona reconozca cuál clave es cuál en
 * una lista, sin volver a mostrar el valor completo.
 */

export const PREFIJO_CLAVE = "eos_";
/** Largo del prefijo visible, incluida la constante de arriba. */
const LARGO_PREFIJO = 12;

export type ClaveGenerada = { clave: string; hash: string; prefijo: string };

export function generarClave(): ClaveGenerada {
  const secreto = randomBytes(24).toString("hex");
  const clave = `${PREFIJO_CLAVE}${secreto}`;
  return { clave, hash: hashDeClave(clave), prefijo: clave.slice(0, LARGO_PREFIJO) };
}

export function hashDeClave(clave: string): string {
  return createHash("sha256").update(clave, "utf8").digest("hex");
}
