import assert from "node:assert/strict";
import { test } from "node:test";

import { formatoMoneda } from "./excel.ts";

/*
 * A diferencia del PDF, Excel no tiene límite de fuente: acá SÍ va el símbolo
 * real de cada moneda, incluido el guaraní. Antes cualquier moneda que no
 * fuera PYG o USD salía marcada con el símbolo del guaraní — un balance en
 * reales se leía como si fuera en guaraníes.
 */

test("guaraníes: formato sin decimales", () => {
  assert.equal(formatoMoneda("PYG"), '"₲" #,##0;[Red]-"₲" #,##0');
});

test("dólares: formato CON decimales, ya no a entero", () => {
  assert.equal(formatoMoneda("USD"), '"US$" #,##0.00;[Red]-"US$" #,##0.00');
});

test("reales y pesos argentinos ya no se etiquetan como guaraníes", () => {
  assert.equal(formatoMoneda("BRL"), '"R$" #,##0.00;[Red]-"R$" #,##0.00');
  assert.equal(formatoMoneda("ARS"), '"AR$" #,##0.00;[Red]-"AR$" #,##0.00');
});

test("euros llevan su símbolo real, sin el límite de fuente del PDF", () => {
  assert.equal(formatoMoneda("EUR"), '"€" #,##0.00;[Red]-"€" #,##0.00');
});
