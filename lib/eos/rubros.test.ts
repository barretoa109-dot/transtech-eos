import assert from "node:assert/strict";
import { test } from "node:test";

import { comienzo, RUBROS, rubroDe } from "./rubros.ts";
import { esPreguntaQueSabes } from "./que-sabes.ts";

test("cada rubro tiene sus ejemplos y las claves no se repiten", () => {
  assert.equal(new Set(RUBROS.map((r) => r.clave)).size, RUBROS.length);
  for (const r of RUBROS) {
    assert.ok(r.etiqueta && r.venta && r.compra && r.tercero.relleno, r.clave);
  }
});

test("rubroDe no inventa: una clave desconocida da null", () => {
  assert.equal(rubroDe("campo")?.etiqueta, "Campo y animales");
  assert.equal(rubroDe("minería espacial"), null);
  assert.equal(rubroDe(undefined), null);
});

test("en la caja queda solo el comienzo del ejemplo, nunca la venta de ejemplo entera", () => {
  for (const r of RUBROS) {
    const c = comienzo(r.venta);
    assert.ok(r.venta.startsWith(c), r.clave);
    assert.ok(c.trim().split(" ").length === 1, `${r.clave}: "${c}" es más que una palabra`);
  }
  assert.equal(comienzo("Vendí 3 lechones a 450 mil"), "Vendí ");
});

test("los ejemplos no disparan una respuesta directa por error", () => {
  for (const r of RUBROS) assert.ok(!esPreguntaQueSabes(r.venta), r.clave);
});
