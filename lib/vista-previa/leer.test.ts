import assert from "node:assert/strict";
import { test } from "node:test";

import { esIpPrivada, leerMetadatos, leerVistaPrevia, validarUrl } from "./leer.ts";

const PUBLICA = async () => ["93.184.216.34"];

test("IPs privadas, locales y reservadas se rechazan", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(esIpPrivada(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.equal(esIpPrivada(ip), false, ip);
});

test("solo http/https públicos, sin puertos raros ni credenciales", async () => {
  assert.equal((await validarUrl("https://abc.com.py/x", PUBLICA)).ok, true);
  for (const u of ["file:///etc/passwd", "ftp://x.com", "http://localhost/", "http://x.com:8080/", "https://user:pw@x.com/", "http://127.0.0.1/", "http://[::1]/", "no es url"]) {
    assert.equal((await validarUrl(u, PUBLICA)).ok, false, u);
  }
  // Un nombre público que resuelve a una IP interna (DNS hacia adentro).
  assert.equal((await validarUrl("https://interno.ejemplo.com/", async () => ["10.0.0.5"])).ok, false);
});

test("una redirección hacia una dirección interna se corta", async () => {
  let pedidos = 0;
  const fetchFalso = (async () => {
    pedidos += 1;
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  }) as unknown as typeof fetch;
  const r = await leerVistaPrevia("https://abc.com.py/nota", { hacerFetch: fetchFalso, resolver: PUBLICA });
  assert.equal(r, null);
  assert.equal(pedidos, 1);
});

test("lee título, descripción e imagen de Open Graph", () => {
  const html = `<html><head><title>Viejo</title>
    <meta property="og:title" content="Contrabando de cerdos &amp; precios">
    <meta name="description" content="El kilo cae a menos de G. 8.000">
    <meta property="og:image" content="/img/cerdo.jpg"></head></html>`;
  const m = leerMetadatos(html, new URL("https://www.abc.com.py/economia/x"));
  assert.equal(m.titulo, "Contrabando de cerdos & precios");
  assert.equal(m.descripcion, "El kilo cae a menos de G. 8.000");
  assert.equal(m.imagen, "https://www.abc.com.py/img/cerdo.jpg");
});

test("sin og usa <title>; una imagen http (no segura) no se muestra", () => {
  const m = leerMetadatos(`<title>Precios</title><meta property="og:image" content="http://x.com/a.jpg">`, new URL("https://x.com"));
  assert.equal(m.titulo, "Precios");
  assert.equal(m.imagen, null);
});

test("lectura completa con una página real simulada; algo que no es HTML no se lee", async () => {
  const html = `<meta property="og:title" content="Cemento 50 kg">`;
  const ok = await leerVistaPrevia("https://www.construshop.com.py/25400", {
    hacerFetch: (async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch,
    resolver: PUBLICA,
  });
  assert.deepEqual(ok, { url: "https://www.construshop.com.py/25400", sitio: "construshop.com.py", titulo: "Cemento 50 kg", descripcion: null, imagen: null });
  const pdf = await leerVistaPrevia("https://x.com/a.pdf", {
    hacerFetch: (async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch,
    resolver: PUBLICA,
  });
  assert.equal(pdf, null);
});
