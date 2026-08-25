import assert from "node:assert/strict";
import { test } from "node:test";

import { destinoSeguro } from "./destino.ts";

const ORIGEN = "https://transtech.com.py";

test("una ruta permitida vuelve tal cual", () => {
  assert.equal(destinoSeguro("/eos/chat", ORIGEN), "/eos/chat");
});

test("conserva la query, que es parte del destino", () => {
  // /pago/tarjeta sin el plan es otra pantalla.
  assert.equal(
    destinoSeguro("/pago/tarjeta?plan=pro&periodicidad=mensual", ORIGEN),
    "/pago/tarjeta?plan=pro&periodicidad=mensual",
  );
});

test("acepta las subrutas de lo permitido", () => {
  assert.equal(destinoSeguro("/eos/onboarding", ORIGEN), "/eos/onboarding");
});

test("un sitio externo NO es destino", () => {
  // Sin esto, /login?next=https://... convierte nuestra pantalla de login en
  // un trampolín con nuestro dominio en la barra hasta el último segundo.
  assert.equal(destinoSeguro("https://sitio-ajeno.com", ORIGEN), "/eos/chat");
});

test("el doble slash tampoco: es un externo disfrazado de ruta", () => {
  assert.equal(destinoSeguro("//sitio-ajeno.com", ORIGEN), "/eos/chat");
  assert.equal(destinoSeguro("//sitio-ajeno.com/algo", ORIGEN), "/eos/chat");
});

test("una ruta interna que no está en la lista cae en el chat", () => {
  assert.equal(destinoSeguro("/admin", ORIGEN), "/eos/chat");
});

test("un prefijo parecido no alcanza para colarse", () => {
  // "/pagos-falsos" empieza con "/pago" como texto, pero no es esa sección.
  assert.equal(destinoSeguro("/pagos-falsos", ORIGEN), "/eos/chat");
});

test("sin destino, al chat", () => {
  assert.equal(destinoSeguro(null, ORIGEN), "/eos/chat");
  assert.equal(destinoSeguro("", ORIGEN), "/eos/chat");
});

test("una ruta rota no rompe el login", () => {
  assert.equal(destinoSeguro("/%%%", ORIGEN), "/eos/chat");
});
