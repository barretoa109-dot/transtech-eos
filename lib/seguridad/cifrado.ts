import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado de credenciales de conectores.
 *
 * La fase 5 de la hoja de ruta lo pide como "nivel bancario, no nivel app
 * promedio". La diferencia entre las dos cosas no es el algoritmo —todo el
 * mundo usa AES— sino cuatro detalles que la mayoría se saltea:
 *
 *   1. **Cifrado autenticado (GCM).** Un ciphertext alterado no se descifra
 *      "raro": falla. Con AES-CBC, que es lo que se usa por costumbre, un
 *      atacante puede modificar el texto cifrado sin que nadie lo note.
 *   2. **IV aleatorio por operación.** Reutilizar el IV en GCM no debilita el
 *      cifrado: lo ROMPE, y permite recuperar la clave de autenticación.
 *   3. **Atado al dueño (AAD).** El ciphertext se liga al usuario y al
 *      proveedor. Copiar la fila de un usuario a otro no le da acceso a nada:
 *      el descifrado falla. Sin esto, quien pueda escribir en la base puede
 *      robar una credencial ajena sin romper ningún cifrado.
 *   4. **Versión y rotación.** El formato lleva versión y `descifrar` acepta
 *      varias claves, así rotar no obliga a un downtime ni a re-cifrar todo de
 *      golpe.
 *
 * La clave NUNCA vive en la base de datos: si estuviera ahí, cifrar no
 * agregaría nada, porque quien se lleva la base se lleva las dos cosas.
 *
 * Hoy no hay conectores con credenciales —la ingesta es por correo y el token
 * del buzón es de ruteo, no una credencial—, pero esto tiene que existir ANTES
 * del primero. Un conector se conecta un martes a la tarde y nadie se acuerda
 * de que las credenciales quedaban en texto plano.
 */

const VERSION = "v1";
const ALGORITMO = "aes-256-gcm";
const LARGO_CLAVE = 32; // AES-256
const LARGO_IV = 12; // el recomendado para GCM
const LARGO_TAG = 16;

export class ErrorDeCifrado extends Error {}

/**
 * Lee las claves del entorno.
 *
 * `EOS_CIFRADO_CLAVE` es la que cifra. `EOS_CIFRADO_CLAVES_VIEJAS` —separadas
 * por coma— solo descifran: durante una rotación conviven las dos hasta que no
 * quede ninguna fila con la anterior.
 */
export function leerClaves(env: Record<string, string | undefined> = process.env): {
  actual: Buffer;
  anteriores: Buffer[];
} {
  const actual = decodificarClave(env.EOS_CIFRADO_CLAVE, "EOS_CIFRADO_CLAVE");

  const anteriores = (env.EOS_CIFRADO_CLAVES_VIEJAS ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c, i) => decodificarClave(c, `EOS_CIFRADO_CLAVES_VIEJAS[${i}]`));

  return { actual, anteriores };
}

function decodificarClave(valor: string | undefined, nombre: string): Buffer {
  // Una variable vacía y una ausente son indistinguibles desde afuera y las
  // dos son un error de configuración: se nombran igual y se detectan igual.
  if (!valor) {
    throw new ErrorDeCifrado(`Falta ${nombre}: no se puede cifrar sin clave.`);
  }

  const clave = Buffer.from(valor, "base64");

  if (clave.length !== LARGO_CLAVE) {
    throw new ErrorDeCifrado(
      `${nombre} tiene ${clave.length} bytes y AES-256 necesita ${LARGO_CLAVE}. Generá una con: openssl rand -base64 32`,
    );
  }

  return clave;
}

/** Genera una clave nueva, para el primer arranque o para rotar. */
export function generarClave(): string {
  return randomBytes(LARGO_CLAVE).toString("base64");
}

/**
 * El contexto que ata el secreto a su dueño.
 *
 * Va como AAD: no se cifra, pero el descifrado falla si no coincide. Es lo que
 * impide que una fila copiada de un usuario a otro sirva para algo.
 */
export function contexto(usuarioId: string, proveedor: string): string {
  return `${VERSION}|${usuarioId}|${proveedor}`;
}

/** Cifra un secreto. El resultado es texto y se puede guardar en una columna. */
export function cifrar(
  secreto: string,
  aad: string,
  claves: { actual: Buffer } = leerClaves(),
): string {
  if (typeof secreto !== "string" || secreto.length === 0) {
    throw new ErrorDeCifrado("No hay nada que cifrar.");
  }

  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv(ALGORITMO, claves.actual, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const cifrado = Buffer.concat([cipher.update(secreto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(tag), b64(cifrado)].join(".");
}

/**
 * Descifra. Prueba la clave actual y después las anteriores, para que una
 * rotación a medio terminar no rompa nada.
 *
 * Cualquier alteración del texto cifrado, del IV, del tag o del contexto hace
 * fallar esto. No devuelve basura: falla.
 */
export function descifrar(
  paquete: string,
  aad: string,
  claves: { actual: Buffer; anteriores: Buffer[] } = leerClaves(),
): string {
  const partes = (paquete ?? "").split(".");

  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new ErrorDeCifrado("El secreto guardado no tiene el formato esperado.");
  }

  const iv = Buffer.from(partes[1], "base64");
  const tag = Buffer.from(partes[2], "base64");
  const cifrado = Buffer.from(partes[3], "base64");

  if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG) {
    throw new ErrorDeCifrado("El secreto guardado está mal formado.");
  }

  for (const clave of [claves.actual, ...claves.anteriores]) {
    try {
      const decipher = createDecipheriv(ALGORITMO, clave, iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);

      return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString("utf8");
    } catch {
      // Clave equivocada o dato alterado: se prueba la siguiente. No se
      // distingue entre los dos casos a propósito — decir "la clave está mal"
      // versus "el dato está alterado" le da información a quien esté probando.
      continue;
    }
  }

  throw new ErrorDeCifrado("No se pudo descifrar el secreto.");
}

/**
 * Compara dos secretos sin filtrar por dónde difieren.
 *
 * Un `===` sobre un token corta en el primer byte distinto, y ese tiempo se
 * puede medir. Se usa para verificar tokens, no para descifrar.
 */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? "", "utf8");
  const bb = Buffer.from(b ?? "", "utf8");

  // `timingSafeEqual` exige el mismo largo, y el largo no es secreto.
  if (ba.length !== bb.length) return false;

  return timingSafeEqual(ba, bb);
}

function b64(buffer: Buffer): string {
  return buffer.toString("base64");
}
