import assert from "node:assert/strict";
import { test } from "node:test";

import { extraerToken } from "./correo-token.ts";

const TOKEN = "a1b2c3d4e5f60718";

test("dirección simple eos-<token>@dominio", () => {
  assert.equal(extraerToken([`eos-${TOKEN}@ingesta.transtech.com.py`]), TOKEN);
});

test("formato 'Nombre <eos-token@dominio>' de un reenvío", () => {
  assert.equal(
    extraerToken([`Banco Avisos <eos-${TOKEN}@ingesta.transtech.com.py>`]),
    TOKEN,
  );
});

test("sufijo + que algunos clientes de correo agregan al reenviar", () => {
  assert.equal(extraerToken([`eos-${TOKEN}+reenvio@ingesta.transtech.com.py`]), TOKEN);
});

test("mayúsculas en la dirección no rompen la resolución", () => {
  assert.equal(extraerToken([`EOS-${TOKEN}@Ingesta.TransTech.com.py`]), TOKEN);
});

test("varios destinatarios: usa el primero que calza, ignora el resto", () => {
  assert.equal(
    extraerToken(["otro@gmail.com", `eos-${TOKEN}@ingesta.transtech.com.py`, "cc@gmail.com"]),
    TOKEN,
  );
});

test("sin ningún destinatario eos-*, devuelve null", () => {
  assert.equal(extraerToken(["alguien@gmail.com", "otro@hotmail.com"]), null);
});

test("lista vacía, devuelve null", () => {
  assert.equal(extraerToken([]), null);
});

test("token con caracteres fuera de hex se rechaza (no es un token válido)", () => {
  assert.equal(extraerToken(["eos-con-guiones-no-hex@ingesta.transtech.com.py"]), null);
});

test("token demasiado corto se rechaza", () => {
  assert.equal(extraerToken(["eos-abc123@ingesta.transtech.com.py"]), null);
});

test("prefijo eos- sin nada después se rechaza", () => {
  assert.equal(extraerToken(["eos-@ingesta.transtech.com.py"]), null);
});
