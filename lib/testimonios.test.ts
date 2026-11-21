import assert from "node:assert/strict";
import { test } from "node:test";

import { TESTIMONIOS, testimoniosPublicables, type Testimonio } from "./testimonios.ts";

const base: Testimonio = {
  nombre: "Ana",
  rubro: "Despensa",
  ciudad: "Capiatá",
  frase: "Le mando un audio y queda cargada la venta.",
  consentimiento: "WhatsApp 2026-12-03",
};

test("sin permiso con fecha, no se muestra", () => {
  assert.equal(testimoniosPublicables([{ ...base, consentimiento: "" }]).length, 0);
  assert.equal(testimoniosPublicables([{ ...base, consentimiento: "me dijo que sí" }]).length, 0);
  assert.equal(testimoniosPublicables([base]).length, 1);
});

test("incompleto, no se muestra", () => {
  assert.equal(testimoniosPublicables([{ ...base, ciudad: " " }]).length, 0);
  assert.equal(testimoniosPublicables([{ ...base, frase: "Bueno" }]).length, 0);
});

test("todo testimonio cargado tiene su permiso", () => {
  assert.equal(testimoniosPublicables(TESTIMONIOS).length, TESTIMONIOS.length);
});
