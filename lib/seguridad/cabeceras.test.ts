import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../next.config.ts";

async function cabeceras() {
  const reglas = await nextConfig.headers!();
  return Object.fromEntries(reglas[0].headers.map((h) => [h.key, h.value]));
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
