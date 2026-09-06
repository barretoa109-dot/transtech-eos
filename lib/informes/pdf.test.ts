import assert from "node:assert/strict";
import { test } from "node:test";

import { plata } from "./pdf.ts";

/*
 * `plata` es la única de las tres reimplementaciones (acá, armar.ts,
 * excel.ts) con una restricción real: la fuente base del PDF no tiene el
 * signo del guaraní, así que PYG y EUR van en texto a propósito. Las demás
 * monedas sí llevan su símbolo real porque son ASCII puro.
 */

test("guaraníes en texto, sin decimales", () => {
  assert.equal(plata(1_500_000, "PYG"), "Gs. 1.500.000");
});

test("dólares con centavos, no redondeados a entero", () => {
  assert.equal(plata(1500.5, "USD"), "US$ 1.500,50");
});

test("reales y pesos argentinos con su símbolo real", () => {
  assert.equal(plata(200, "BRL"), "R$ 200,00");
  assert.equal(plata(200, "ARS"), "AR$ 200,00");
});

test("euros en texto, por el mismo límite de fuente que el guaraní", () => {
  assert.equal(plata(200, "EUR"), "EUR 200,00");
});
