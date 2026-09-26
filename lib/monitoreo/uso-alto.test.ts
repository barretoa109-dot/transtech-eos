import assert from "node:assert/strict";
import { test } from "node:test";

import { describirCuenta, redactarAvisoUsoAlto, type CuentaUsoAlto } from "./uso-alto.ts";
import { UMBRAL_COSTO_PYG, aGuaranies, pygPorUsd, umbralCosto } from "./umbral-costo.ts";

const cuenta = (extra: Partial<CuentaUsoAlto> = {}): CuentaUsoAlto => ({
  usuario_id: "u1",
  email: "ana@ejemplo.com",
  plan: "business",
  mensajes: 180,
  costo_usd: 9.1,
  ...extra,
});

test("el umbral es Gs. 70.000 de consumo, decidido por el dueño", () => {
  assert.equal(UMBRAL_COSTO_PYG, 70_000);
});

test("a 8.000 por dólar, Gs. 70.000 son USD 8,75, o 175 mensajes si no hay costo", () => {
  assert.deepEqual(umbralCosto({}), { usd: 8.75, mensajesSinCosto: 175 });
});

test("el tipo de cambio se puede configurar, y uno inválido cae al de siempre", () => {
  assert.equal(pygPorUsd({ EOS_PYG_POR_USD: "7300" }), 7300);
  assert.equal(pygPorUsd({ EOS_PYG_POR_USD: "cero" }), 8000);
  assert.equal(pygPorUsd({ EOS_PYG_POR_USD: "-1" }), 8000);
  // Un dólar más barato sube el umbral en dólares.
  assert.equal(umbralCosto({ EOS_PYG_POR_USD: "7000" }).usd, 10);
});

test("el costo se convierte a guaraníes", () => {
  assert.equal(aGuaranies(9.1, {}), 72_800);
});

test("la línea dice quién, cuánto consumió en guaraníes y dólares, los mensajes y el plan", () => {
  assert.equal(
    describirCuenta(cuenta()),
    "ana@ejemplo.com · Gs. 72.800 de consumo (USD 9.1) · 180 mensajes · plan business",
  );
});

test("sin costo registrado no inventa un Gs. 0", () => {
  assert.equal(
    describirCuenta(cuenta({ costo_usd: 0 })),
    "ana@ejemplo.com · sin costo registrado · 180 mensajes · plan business",
  );
});

test("sin correo muestra el id, no 'null'", () => {
  assert.ok(describirCuenta(cuenta({ email: null })).startsWith("u1 ·"));
});

test("el aviso dice que es antes de la pérdida y que a la persona no se le cortó nada", () => {
  const { texto, html, asunto } = redactarAvisoUsoAlto([cuenta()], "https://eos.test");
  assert.match(texto, /antes de que la cuenta dé pérdida/);
  assert.match(texto, /siguen conversando con normalidad/);
  assert.match(html, /siguen conversando con normalidad/);
  assert.match(asunto, /una cuenta llegó a Gs\. 70\.000 de consumo/);
});

test("con varias cuentas pone el plural y las lista a todas", () => {
  const { texto, asunto } = redactarAvisoUsoAlto(
    [cuenta(), cuenta({ usuario_id: "u2", email: "b@e.com", costo_usd: 12 })],
    "x",
  );
  assert.match(asunto, /2 cuentas llegaron a Gs\. 70\.000 de consumo/);
  assert.ok(texto.includes("ana@ejemplo.com") && texto.includes("b@e.com"));
});

test("un correo con signos raros no rompe el HTML del aviso", () => {
  const { html } = redactarAvisoUsoAlto([cuenta({ email: "a<b>&c@e.com" })], "x");
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("a&lt;b>&amp;c@e.com"));
});
