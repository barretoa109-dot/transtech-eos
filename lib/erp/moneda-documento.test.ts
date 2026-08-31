import assert from "node:assert/strict";
import test from "node:test";

import { avisoMonedasMezcladas, monedaDelDocumento } from "./moneda-documento.ts";

test("un documento vacío se muestra en la moneda por defecto", () => {
  assert.deepEqual(monedaDelDocumento([]), { ok: true, moneda: "PYG" });
  assert.deepEqual(monedaDelDocumento([], "USD"), { ok: true, moneda: "USD" });
});

test("todas las líneas en la misma moneda dan esa moneda", () => {
  assert.deepEqual(monedaDelDocumento(["USD", "USD", "USD"]), { ok: true, moneda: "USD" });
  assert.deepEqual(monedaDelDocumento(["PYG"]), { ok: true, moneda: "PYG" });
});

test("una moneda desconocida o ausente cae en la por defecto, no rompe el documento", () => {
  assert.deepEqual(monedaDelDocumento([null, undefined, "", "no-existe"]), {
    ok: true,
    moneda: "PYG",
  });
});

test("mezclar monedas no devuelve una moneda: devuelve el problema", () => {
  const resultado = monedaDelDocumento(["PYG", "USD"]);

  assert.equal(resultado.ok, false);
  assert.deepEqual((resultado as { monedas: string[] }).monedas, ["PYG", "USD"]);
});

test("la mezcla se detecta aunque la moneda venga escrita distinto", () => {
  assert.equal(monedaDelDocumento(["usd", "USD"]).ok, true);
  assert.equal(monedaDelDocumento([" usd ", "PYG"]).ok, false);
});

test("el aviso nombra las monedas y dice qué hacer", () => {
  const texto = avisoMonedasMezcladas(["PYG", "USD"]);

  assert.match(texto, /PYG y USD/);
  assert.match(texto, /dos documentos/);
});

// El caso que motivó todo esto: el catálogo tenía un producto en dólares y la
// pantalla lo usaba para etiquetar TODAS las ventas.
test("la moneda sale de las líneas del documento, no del catálogo entero", () => {
  const catalogo = ["USD", "PYG", "PYG", "PYG"];
  const enEsteDocumento = [catalogo[1], catalogo[2]];

  assert.deepEqual(monedaDelDocumento(enEsteDocumento), { ok: true, moneda: "PYG" });
});
