import test from "node:test";
import assert from "node:assert/strict";

import {
  cacheadosDeUsage,
  costoDelMensaje,
  normalizarTokens,
  tarifasDelEntorno,
} from "./costo-mensaje.ts";

const GPT55 = {
  EOS_USD_POR_MTOK_ENTRADA: "5",
  EOS_USD_POR_MTOK_ENTRADA_CACHEADA: "0.5",
  EOS_USD_POR_MTOK_SALIDA: "30",
};

test("los tokens cacheados se cobran a la tarifa cacheada, no a la completa", () => {
  const tokens = normalizarTokens({
    tokens_entrada: 10_000,
    tokens_entrada_cacheados: 8_000,
    tokens_salida: 500,
  });
  const costo = costoDelMensaje(tokens, tarifasDelEntorno(GPT55));
  // 2.000 × 5/M + 8.000 × 0,5/M + 500 × 30/M = 0,01 + 0,004 + 0,015
  assert.equal(Number(costo.toFixed(6)), 0.029);
});

test("sin caché, el costo es el mismo de antes", () => {
  const tokens = normalizarTokens({ tokens_entrada: 10_000, tokens_salida: 500 });
  const costo = costoDelMensaje(tokens, tarifasDelEntorno(GPT55));
  assert.equal(Number(costo.toFixed(6)), 0.065);
});

test("el descuento baja el costo de un mensaje típico más de la mitad", () => {
  // Forma medida en septiembre: prompt del sistema grande y cacheado.
  const con = costoDelMensaje(
    normalizarTokens({ tokens_entrada: 9_000, tokens_entrada_cacheados: 7_900, tokens_salida: 200 }),
    tarifasDelEntorno(GPT55),
  );
  const sin = costoDelMensaje(
    normalizarTokens({ tokens_entrada: 9_000, tokens_salida: 200 }),
    tarifasDelEntorno(GPT55),
  );
  assert.ok(sin / con > 2, `esperaba > 2x, fue ${(sin / con).toFixed(2)}x`);
});

test("sin la variable de tarifa cacheada no se inventa un descuento", () => {
  const tarifas = tarifasDelEntorno({
    EOS_USD_POR_MTOK_ENTRADA: "5",
    EOS_USD_POR_MTOK_SALIDA: "30",
  });
  assert.equal(tarifas.entradaCacheada, 5);
  const tokens = normalizarTokens({ tokens_entrada: 10_000, tokens_entrada_cacheados: 8_000 });
  assert.equal(Number(costoDelMensaje(tokens, tarifas).toFixed(6)), 0.05);
});

test("la tarifa cacheada en cero explícito se respeta (caché gratis)", () => {
  const tarifas = tarifasDelEntorno({ ...GPT55, EOS_USD_POR_MTOK_ENTRADA_CACHEADA: "0" });
  assert.equal(tarifas.entradaCacheada, 0);
});

test("sin tarifas configuradas el costo es cero, como antes", () => {
  const tokens = normalizarTokens({ tokens_entrada: 10_000, tokens_salida: 500 });
  assert.equal(costoDelMensaje(tokens, tarifasDelEntorno({})), 0);
});

test("más cacheados que entrada se recortan: nunca un costo negativo", () => {
  const tokens = normalizarTokens({ tokens_entrada: 100, tokens_entrada_cacheados: 5_000 });
  assert.equal(tokens.entradaCacheada, 100);
  assert.ok(costoDelMensaje(tokens, tarifasDelEntorno(GPT55)) >= 0);
});

test("basura en los tokens cuenta como cero", () => {
  const tokens = normalizarTokens({
    tokens_entrada: "abc",
    tokens_entrada_cacheados: -3,
    tokens_salida: null,
  });
  assert.deepEqual(tokens, { entrada: 0, entradaCacheada: 0, salida: 0 });
});

test("lee cached_tokens de la Responses API y de Chat Completions", () => {
  assert.equal(cacheadosDeUsage({ input_tokens_details: { cached_tokens: 1_234 } }), 1_234);
  assert.equal(cacheadosDeUsage({ prompt_tokens_details: { cached_tokens: 99 } }), 99);
  assert.equal(cacheadosDeUsage({ input_tokens: 5 }), 0);
  assert.equal(cacheadosDeUsage(undefined), 0);
});
