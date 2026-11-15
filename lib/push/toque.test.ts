import assert from "node:assert/strict";
import test from "node:test";

import { rutaDeAviso } from "./toque.ts";

test("una ruta interna se acepta tal cual", () => {
  assert.equal(rutaDeAviso({ url: "/eos/chat?vista=calendario" }), "/eos/chat?vista=calendario");
});

test("una dirección de afuera no se navega, venga como venga", () => {
  for (const url of ["https://otro.sitio/x", "//otro.sitio/x", "/\\otro.sitio", "javascript:alert(1)", "eos/chat"]) {
    assert.equal(rutaDeAviso({ url }), null, url);
  }
});

test("sin url, o con datos raros, no hay a dónde ir", () => {
  for (const datos of [null, undefined, "texto", {}, { url: 7 }, { url: "" }, { url: "/a\nb" }]) {
    assert.equal(rutaDeAviso(datos), null);
  }
});
