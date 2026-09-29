import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ESQUEMA_APP,
  MARCA_APP_NATIVA,
  callbackDesdeEnlaceApp,
  esAppNativa,
  esRutaDeCompra,
  redireccionOAuthApp,
} from "./plataforma.ts";

const ORIGEN = "https://transtech.com.py";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-A145M Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 EOSApp/1";
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EOSApp/1";
const UA_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

test("reconoce la app nativa en Android y en iPhone", () => {
  assert.equal(esAppNativa(UA_ANDROID), true);
  assert.equal(esAppNativa(UA_IPHONE), true);
});

test("un navegador común no es la app", () => {
  assert.equal(esAppNativa(UA_CHROME), false);
  assert.equal(esAppNativa(""), false);
  assert.equal(esAppNativa(null), false);
  assert.equal(esAppNativa(undefined), false);
});

test("la marca tiene que ser una palabra entera, no un pedazo de otra", () => {
  assert.equal(esAppNativa(`${UA_CHROME} MiEOSApp/1`), false);
  assert.equal(esAppNativa(`${UA_CHROME} EOSApp/`), false);
});

test("la marca coincide con la que agrega capacitor.config.ts", () => {
  const config = readFileSync(new URL("../../capacitor.config.ts", import.meta.url), "utf8");
  assert.match(config, new RegExp(`appendUserAgent:\\s*"${MARCA_APP_NATIVA.replace("/", "\\/")}"`));
  assert.equal(esAppNativa(`${UA_CHROME} ${MARCA_APP_NATIVA}`), true);
});

test("planes y pago son rutas de compra, con sus subrutas", () => {
  for (const ruta of ["/planes", "/planes/", "/pago", "/pago/tarjeta", "/pago/resultado"]) {
    assert.equal(esRutaDeCompra(ruta), true, ruta);
  }
});

test("lo demás no es una ruta de compra", () => {
  for (const ruta of ["/", "/eos/chat", "/planesx", "/pagos", "/api/pagos/bancard/confirmacion", "/login"]) {
    assert.equal(esRutaDeCompra(ruta), false, ruta);
  }
});

test("la redirección de OAuth vuelve a la app con el destino pedido", () => {
  assert.equal(
    redireccionOAuthApp("/eos/onboarding"),
    `${ESQUEMA_APP}://auth/callback?next=%2Feos%2Fonboarding`,
  );
});

test("el enlace de vuelta se convierte en el callback web de siempre", () => {
  assert.equal(
    callbackDesdeEnlaceApp(`${ESQUEMA_APP}://auth/callback?code=abc123&next=%2Feos%2Fchat`, ORIGEN),
    "/auth/callback?code=abc123&next=%2Feos%2Fchat",
  );
});

test("un error del proveedor también llega al callback", () => {
  assert.equal(
    callbackDesdeEnlaceApp(
      `${ESQUEMA_APP}://auth/callback?error=access_denied&error_description=cancelado`,
      ORIGEN,
    ),
    "/auth/callback?error=access_denied&error_description=cancelado",
  );
});

test("descarta parámetros que no son del callback", () => {
  assert.equal(
    callbackDesdeEnlaceApp(`${ESQUEMA_APP}://auth/callback?code=abc&redirect=https://otro.sitio`, ORIGEN),
    "/auth/callback?code=abc",
  );
});

test("otros enlaces con el esquema de la app no navegan a ninguna parte", () => {
  assert.equal(callbackDesdeEnlaceApp(`${ESQUEMA_APP}://otra/cosa?code=abc`, ORIGEN), null);
  assert.equal(callbackDesdeEnlaceApp(`${ESQUEMA_APP}://auth/callback`, ORIGEN), null);
  assert.equal(callbackDesdeEnlaceApp("https://transtech.com.py/auth/callback?code=abc", ORIGEN), null);
  assert.equal(callbackDesdeEnlaceApp("no es una url", ORIGEN), null);
});
