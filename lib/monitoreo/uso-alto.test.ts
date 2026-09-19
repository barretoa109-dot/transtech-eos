import assert from "node:assert/strict";
import { test } from "node:test";

import { UMBRAL_USO_ALTO, describirCuenta, redactarAvisoUsoAlto, type CuentaUsoAlto } from "./uso-alto.ts";

const cuenta = (extra: Partial<CuentaUsoAlto> = {}): CuentaUsoAlto => ({
  usuario_id: "u1",
  email: "ana@ejemplo.com",
  plan: "business",
  mensajes: 450,
  costo_usd: 22.5,
  ...extra,
});

test("el umbral interno es de 400 mensajes", () => {
  assert.equal(UMBRAL_USO_ALTO, 400);
});

test("la línea dice quién, cuántos mensajes, el plan y lo que costó", () => {
  assert.equal(describirCuenta(cuenta()), "ana@ejemplo.com · 450 mensajes · plan business · USD 22.5");
});

test("sin costo valorado no inventa un USD 0", () => {
  assert.equal(describirCuenta(cuenta({ costo_usd: 0 })), "ana@ejemplo.com · 450 mensajes · plan business");
});

test("sin correo muestra el id, no 'null'", () => {
  assert.ok(describirCuenta(cuenta({ email: null })).startsWith("u1 ·"));
});

test("el aviso aclara que a la persona no se le cortó ni se le dijo nada", () => {
  const { texto, html, asunto } = redactarAvisoUsoAlto([cuenta()], "https://eos.test");
  assert.match(texto, /siguen conversando con normalidad/);
  assert.match(html, /siguen conversando con normalidad/);
  assert.match(asunto, /una cuenta llegó a 400 mensajes/);
});

test("con varias cuentas pone el plural y las lista a todas", () => {
  const { texto, asunto } = redactarAvisoUsoAlto([cuenta(), cuenta({ usuario_id: "u2", email: "b@e.com", mensajes: 900 })], "x");
  assert.match(asunto, /2 cuentas llegaron a 400 mensajes/);
  assert.ok(texto.includes("ana@ejemplo.com") && texto.includes("b@e.com"));
});

test("un correo con signos raros no rompe el HTML del aviso", () => {
  const { html } = redactarAvisoUsoAlto([cuenta({ email: "a<b>&c@e.com" })], "x");
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("a&lt;b>&amp;c@e.com"));
});
