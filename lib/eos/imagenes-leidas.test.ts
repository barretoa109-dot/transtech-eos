import assert from "node:assert/strict";
import { test } from "node:test";

import { bloqueDeContexto, leerImagen, textoDeRespuesta } from "./imagenes-leidas.ts";

test("lee el texto de la Responses API en sus dos formas", () => {
  assert.equal(textoDeRespuesta({ output_text: "  Vestido azul claro 1 x USD 120  " }), "Vestido azul claro 1 x USD 120");
  assert.equal(
    textoDeRespuesta({
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "Camiseta x3" }, { type: "output_text", text: "Total USD 150" }] },
      ],
    }),
    "Camiseta x3\nTotal USD 150",
  );
  assert.equal(textoDeRespuesta({}), null);
  assert.equal(textoDeRespuesta(null), null);
  assert.equal(textoDeRespuesta({ output_text: "x".repeat(10_000) })?.length, 4000);
});

test("las imágenes anteriores entran al contexto con la instrucción de usarlas", () => {
  assert.equal(bloqueDeContexto([]), "");
  const bloque = bloqueDeContexto([{ contenido: "Vestido azul claro USD 120" }]);
  assert.ok(bloque.includes("\"estos\""));
  assert.ok(bloque.includes("no le pidas que repita"));
  assert.ok(bloque.includes("--- Imagen 1 ---\nVestido azul claro USD 120"));
});

test("sin clave o sin imagen no llama a nadie y no lanza", async () => {
  const antes = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(await leerImagen({ nombre: "a.jpg", tipo: "image/jpeg", base64: "AAAA" }), null);
  } finally {
    if (antes !== undefined) process.env.OPENAI_API_KEY = antes;
  }
  process.env.OPENAI_API_KEY = "prueba";
  try {
    assert.equal(await leerImagen({ nombre: "a.pdf", tipo: "application/pdf", base64: "AAAA" }), null);
  } finally {
    if (antes === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = antes;
  }
});

test("la lectura de una imagen informa lo que costó, para sumarlo al consumo del mes", async () => {
  const antes = { ...process.env };
  const fetchOriginal = globalThis.fetch;
  Object.assign(process.env, {
    OPENAI_API_KEY: "prueba",
    EOS_USD_POR_MTOK_ENTRADA: "5",
    EOS_USD_POR_MTOK_ENTRADA_CACHEADA: "0.5",
    EOS_USD_POR_MTOK_SALIDA: "30",
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ output_text: "Vestido azul USD 120", usage: { input_tokens: 1_000, output_tokens: 100 } }),
      { status: 200 },
    )) as typeof fetch;

  try {
    const costos: number[] = [];
    const texto = await leerImagen(
      { nombre: "a.jpg", tipo: "image/jpeg", base64: "AAAA" },
      { alCosto: (usd) => costos.push(usd) },
    );
    assert.equal(texto, "Vestido azul USD 120");
    // 1.000 × 5 + 100 × 30, por millón.
    assert.deepEqual(costos.map((c) => Number(c.toFixed(6))), [0.008]);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const clave of Object.keys(process.env)) if (!(clave in antes)) delete process.env[clave];
    Object.assign(process.env, antes);
  }
});
