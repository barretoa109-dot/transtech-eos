import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ErrorDeCifrado,
  cifrar,
  contexto,
  descifrar,
  generarClave,
  igualesEnTiempoConstante,
  leerClaves,
} from "./cifrado.ts";

const CLAVE = generarClave();
const OTRA = generarClave();

function claves(actual = CLAVE, anteriores: string[] = []) {
  return leerClaves({
    EOS_CIFRADO_CLAVE: actual,
    EOS_CIFRADO_CLAVES_VIEJAS: anteriores.join(","),
  });
}

const AAD = contexto("11111111-1111-4111-8111-111111111111", "banco-gnb");

test("lo cifrado se recupera igual", () => {
  const k = claves();
  const paquete = cifrar("token-secreto-del-banco", AAD, k);

  assert.notEqual(paquete, "token-secreto-del-banco");
  assert.equal(descifrar(paquete, AAD, k), "token-secreto-del-banco");
});

test("el mismo secreto cifrado dos veces da distinto", () => {
  // IV aleatorio por operación. Si diera igual, un observador sabría que dos
  // usuarios tienen la misma credencial sin descifrar nada.
  const k = claves();

  assert.notEqual(cifrar("igual", AAD, k), cifrar("igual", AAD, k));
});

test("alterar el texto cifrado NO devuelve basura: falla", () => {
  // Es la diferencia entre GCM y el AES-CBC que se usa por costumbre.
  const k = claves();
  const paquete = cifrar("token", AAD, k);
  const partes = paquete.split(".");

  const cifradoMalo = Buffer.from(partes[3], "base64");
  cifradoMalo[0] ^= 0xff;
  partes[3] = cifradoMalo.toString("base64");

  assert.throws(() => descifrar(partes.join("."), AAD, k), ErrorDeCifrado);
});

test("alterar el tag de autenticación falla", () => {
  const k = claves();
  const partes = cifrar("token", AAD, k).split(".");

  const tagMalo = Buffer.from(partes[2], "base64");
  tagMalo[0] ^= 0xff;
  partes[2] = tagMalo.toString("base64");

  assert.throws(() => descifrar(partes.join("."), AAD, k), ErrorDeCifrado);
});

test("una credencial copiada a OTRO usuario no se descifra", () => {
  // El ataque que el AAD existe para frenar: quien pueda escribir en la base
  // copia la fila de otro y usa su conexión al banco. Acá no le sirve.
  const k = claves();
  const paquete = cifrar("token-de-marta", AAD, k);

  const deOtro = contexto("22222222-2222-4222-8222-222222222222", "banco-gnb");

  assert.throws(() => descifrar(paquete, deOtro, k), ErrorDeCifrado);
});

test("la misma credencial reapuntada a otro proveedor tampoco", () => {
  const k = claves();
  const paquete = cifrar("token", AAD, k);
  const otroProveedor = contexto("11111111-1111-4111-8111-111111111111", "otro-banco");

  assert.throws(() => descifrar(paquete, otroProveedor, k), ErrorDeCifrado);
});

test("con la clave equivocada no se descifra", () => {
  const paquete = cifrar("token", AAD, claves());

  assert.throws(() => descifrar(paquete, AAD, claves(OTRA)), ErrorDeCifrado);
});

test("una rotación a medio terminar no rompe lo viejo", () => {
  // Se cifró con la clave vieja; hoy la actual es otra. Sigue funcionando
  // mientras la vieja esté declarada, así rotar no exige re-cifrar de golpe.
  const viejo = cifrar("token-de-antes", AAD, claves(OTRA));

  assert.equal(descifrar(viejo, AAD, claves(CLAVE, [OTRA])), "token-de-antes");
});

test("terminada la rotación, lo viejo deja de funcionar", () => {
  const viejo = cifrar("token-de-antes", AAD, claves(OTRA));

  assert.throws(() => descifrar(viejo, AAD, claves(CLAVE)), ErrorDeCifrado);
});

/* ==================== CONFIGURACIÓN ==================== */

test("sin clave, falla al arrancar y dice cuál falta", () => {
  assert.throws(
    () => leerClaves({}),
    /Falta EOS_CIFRADO_CLAVE/,
  );
});

test("una clave vacía se trata igual que una ausente", () => {
  // Ya pasó en este proyecto con RESEND_API_KEY: una variable con valor vacío
  // y una ausente son indistinguibles desde afuera, y las dos son un error.
  assert.throws(
    () => leerClaves({ EOS_CIFRADO_CLAVE: "" }),
    /Falta EOS_CIFRADO_CLAVE/,
  );
});

test("una clave del largo equivocado dice cómo generar una buena", () => {
  assert.throws(
    () => leerClaves({ EOS_CIFRADO_CLAVE: Buffer.from("corta").toString("base64") }),
    /openssl rand -base64 32/,
  );
});

test("un paquete con formato raro no se intenta descifrar", () => {
  assert.throws(() => descifrar("no-es-un-paquete", AAD, claves()), ErrorDeCifrado);
  assert.throws(() => descifrar("v9.a.b.c", AAD, claves()), ErrorDeCifrado);
});

/* ==================== COMPARACIÓN ==================== */

test("la comparación en tiempo constante funciona como comparación", () => {
  assert.equal(igualesEnTiempoConstante("abc", "abc"), true);
  assert.equal(igualesEnTiempoConstante("abc", "abd"), false);
  assert.equal(igualesEnTiempoConstante("abc", "abcd"), false);
  assert.equal(igualesEnTiempoConstante("", ""), true);
});
