import test from "node:test";
import assert from "node:assert/strict";

import { anunciosContradichos, esAnuncio, sinAnuncios } from "./sin-anuncios.ts";

/**
 * El caso del lechón (08/11/2026): AJUSTAR_STOCK no tiene frase fija, así que
 * el modelo anuncia con el verbo que le salga. "Voy a descontar un lechón del
 * stock por la pérdida de hoy." no quedaba cubierto por la lista de verbos, y
 * cuando el efecto interno fallaba ese anuncio se mandaba igual, pegado al
 * error, como si la acción sí se hubiera hecho.
 */
test("esAnuncio reconoce 'voy a descontar' (AJUSTAR_STOCK)", () => {
  assert.equal(esAnuncio("Voy a descontar un lechón del stock por la pérdida de hoy."), true);
});

test("esAnuncio reconoce 'descuento' y 'desconté'", () => {
  assert.equal(esAnuncio("Descuento un lechón del stock."), true);
  assert.equal(esAnuncio("Desconté un lechón del stock."), true);
});

test("esAnuncio reconoce 'ajusto'/'ajusté' y 'resto'/'resté'", () => {
  assert.equal(esAnuncio("Ajusto el stock de lechones."), true);
  assert.equal(esAnuncio("Ajusté el stock de lechones."), true);
  assert.equal(esAnuncio("Resto un lechón del stock."), true);
  assert.equal(esAnuncio("Resté un lechón del stock."), true);
  assert.equal(esAnuncio("Voy a ajustar el stock."), true);
  assert.equal(esAnuncio("Voy a restar uno del stock."), true);
});

test("sinAnuncios saca el aviso del lechón cuando el efecto interno falló", () => {
  const resultados = [{ ok: false, error: "No fue posible ejecutar el efecto interno." }];

  assert.equal(anunciosContradichos(resultados), true);

  const texto =
    "Qué pena, Augusto. Voy a descontar un lechón del stock por la pérdida de hoy.";

  // Lo único que queda es la parte que no anuncia un registro.
  assert.equal(sinAnuncios(texto), "Qué pena, Augusto.");
});

test("sin fallas, el anuncio se queda (coincide con lo que pasó de verdad)", () => {
  assert.equal(anunciosContradichos([{ ok: true, resultado: {} }]), false);
});
