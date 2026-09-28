import test from "node:test";
import assert from "node:assert/strict";
import nextConfig, { RUTAS_ANTI_IFRAME } from "../../next.config.ts";

async function reglas() {
  return nextConfig.headers!();
}

async function cabeceras() {
  return Object.fromEntries((await reglas()).flatMap((r) => r.headers).map((h) => [h.key, h.value]));
}

/** Traduce la fuente de Next a una expresión regular (solo la forma que usa este archivo). */
function aplica(ruta: string) {
  return new RegExp(`^${RUTAS_ANTI_IFRAME}$`).test(ruta);
}

test("todas las rutas llevan las cabeceras de seguridad", async () => {
  const h = await cabeceras();
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.ok(h["Referrer-Policy"]);
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
});

test("el micrófono sigue permitido: el dictado del chat lo necesita", async () => {
  const h = await cabeceras();
  assert.match(h["Permissions-Policy"], /microphone=\(self\)/);
});

test("la vuelta del 3DS se puede dibujar dentro del iframe de Bancard", () => {
  assert.equal(aplica("/pago/resultado"), false);
  assert.equal(aplica("/pago/resultado/"), false);
});

test("el resto del sitio no se puede embeber", () => {
  for (const ruta of ["/", "/eos/chat", "/login", "/pago/tarjeta", "/planes", "/api/eos"]) {
    assert.equal(aplica(ruta), true, ruta);
  }
});
