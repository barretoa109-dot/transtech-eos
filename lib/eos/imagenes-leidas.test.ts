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
