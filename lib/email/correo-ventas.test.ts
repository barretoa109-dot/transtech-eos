import assert from "node:assert/strict";
import { test } from "node:test";

import { claveCorreoVentas, validarPedidoCorreoVentas } from "./correo-ventas.ts";

const BUENO = { to: "Cliente@Gmail.com", subject: "Re: Precios", html: "<p>Hola</p>" };

test("un pedido normal pasa, con el destinatario en minúsculas", () => {
  const v = validarPedidoCorreoVentas(BUENO);
  assert.ok(v.ok);
  assert.equal(v.ok && v.pedido.to, "cliente@gmail.com");
});

test("no se le contesta al propio dominio ni a direcciones automáticas", () => {
  for (const to of ["ventas@transtech.com.py", "no-reply@empresa.com", "noreply@x.com", "mailer-daemon@googlemail.com"]) {
    assert.equal(validarPedidoCorreoVentas({ ...BUENO, to }).ok, false, to);
  }
});

test("un solo destinatario: listas y encabezados inyectados se rechazan", () => {
  for (const to of ["a@x.com, b@y.com", "a@x.com;b@y.com", "Nombre <a@x.com>", "a@x.com\nBcc: b@y.com", ""]) {
    assert.equal(validarPedidoCorreoVentas({ ...BUENO, to }).ok, false, JSON.stringify(to));
  }
});

test("asunto y cuerpo tienen que existir y tener un tamaño razonable", () => {
  assert.equal(validarPedidoCorreoVentas({ ...BUENO, subject: "" }).ok, false);
  assert.equal(validarPedidoCorreoVentas({ ...BUENO, subject: "x".repeat(201) }).ok, false);
  assert.equal(validarPedidoCorreoVentas({ ...BUENO, html: "" }).ok, false);
  assert.equal(validarPedidoCorreoVentas({ ...BUENO, html: "x".repeat(20_001) }).ok, false);
  assert.equal(validarPedidoCorreoVentas(null).ok, false);
});

test("la misma respuesta al mismo cliente da la misma clave; otra respuesta, otra clave", () => {
  const a = validarPedidoCorreoVentas(BUENO);
  const b = validarPedidoCorreoVentas({ ...BUENO, to: "cliente@gmail.com" });
  const c = validarPedidoCorreoVentas({ ...BUENO, html: "<p>Otra cosa</p>" });
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(claveCorreoVentas(a.pedido), claveCorreoVentas(b.pedido));
  assert.notEqual(claveCorreoVentas(a.pedido), claveCorreoVentas(c.pedido));
});
