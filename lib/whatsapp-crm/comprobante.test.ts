import assert from "node:assert/strict";
import test from "node:test";

import { comprobanteIaHabilitada, leerComprobante, leerRespuesta, type Fetcher } from "./comprobante.ts";

const ENV = { EOS_COMPROBANTE_IA: "1", OPENAI_API_KEY: "sk-prueba" };

const json = (es_comprobante: boolean, monto: number | null, moneda: string | null, fecha: string | null) =>
  JSON.stringify({ es_comprobante, monto, moneda, fecha });

// ------------------------------------------------------------------ encendido

test("apagado por defecto: sin la variable no se lee nada", () => {
  assert.equal(comprobanteIaHabilitada({ OPENAI_API_KEY: "sk" }), false);
  assert.equal(comprobanteIaHabilitada({ EOS_COMPROBANTE_IA: "1" }), false);
  assert.equal(comprobanteIaHabilitada(ENV), true);
});

test("apagado, leerComprobante no sale a la red", async () => {
  let llamadas = 0;
  const fetcher = (async () => {
    llamadas += 1;
    return new Response(JSON.stringify({ output_text: json(true, 100000, "PYG", null) }), { status: 200 });
  }) as unknown as Fetcher;

  const r = await leerComprobante("data:image/jpeg;base64,abc", { fetcher, env: { OPENAI_API_KEY: "sk" } });
  assert.equal(r, null);
  assert.equal(llamadas, 0);
});

// ----------------------------------------------------------------- la lectura

test("un comprobante claro: monto, moneda y fecha", () => {
  assert.deepEqual(leerRespuesta({ output_text: json(true, 139000, "PYG", "2026-10-13") }), {
    monto: 139000,
    moneda: "PYG",
    fecha: "2026-10-13",
  });
});

test("sin moneda declarada, se asume guaraníes", () => {
  assert.deepEqual(leerRespuesta({ output_text: json(true, 50000, null, null) }), {
    monto: 50000,
    moneda: "PYG",
    fecha: null,
  });
});

test("dólares, cuando el modelo lo dice", () => {
  assert.deepEqual(leerRespuesta({ output_text: json(true, 20, "USD", null) }), {
    monto: 20,
    moneda: "USD",
    fecha: null,
  });
});

test("una fecha con un formato raro se descarta, no se inventa", () => {
  assert.deepEqual(leerRespuesta({ output_text: json(true, 1000, "PYG", "13/10/2026") }), {
    monto: 1000,
    moneda: "PYG",
    fecha: null,
  });
});

// ------------------------------------------------------- lo que nunca se acepta

test("no es un comprobante: null, aunque traiga un monto", () => {
  assert.equal(leerRespuesta({ output_text: json(false, 139000, "PYG", null) }), null);
});

test("un monto que no se puede leer: null, nunca se inventa un número", () => {
  assert.equal(leerRespuesta({ output_text: json(true, null, "PYG", null) }), null);
  assert.equal(leerRespuesta({ output_text: json(true, 0, "PYG", null) }), null);
  assert.equal(leerRespuesta({ output_text: json(true, -500, "PYG", null) }), null);
});

test("una respuesta rota o sin JSON: null", () => {
  assert.equal(leerRespuesta({ output_text: "no entendí la imagen" }), null);
  assert.equal(leerRespuesta({ output_text: "{roto" }), null);
  assert.equal(leerRespuesta(null), null);
});

test("tolera el JSON con texto alrededor y la otra forma de la respuesta", () => {
  assert.deepEqual(leerRespuesta({ output_text: `Acá está: ${json(true, 75000, "PYG", null)} listo` }), {
    monto: 75000,
    moneda: "PYG",
    fecha: null,
  });
  assert.deepEqual(leerRespuesta({ output: [{ content: [{ text: json(true, 10000, "PYG", null) }] }] }), {
    monto: 10000,
    moneda: "PYG",
    fecha: null,
  });
});

// ------------------------------------------------------------------ las caídas

test("si el proveedor falla, tarda o contesta cualquier cosa, no se inventa nada", async () => {
  const original = console.error;
  console.error = () => {};

  try {
    const falla500 = (async () => new Response("", { status: 500 })) as unknown as Fetcher;
    assert.equal(await leerComprobante("data:image/jpeg;base64,abc", { fetcher: falla500, env: ENV }), null);

    const basura = (async () => new Response(JSON.stringify({ output_text: "esto no es json" }), { status: 200 })) as unknown as Fetcher;
    assert.equal(await leerComprobante("data:image/jpeg;base64,abc", { fetcher: basura, env: ENV }), null);

    const roto = (async () => {
      throw new Error("red");
    }) as unknown as Fetcher;
    assert.equal(await leerComprobante("data:image/jpeg;base64,abc", { fetcher: roto, env: ENV }), null);

    const colgado = ((_: string, init: RequestInit) =>
      new Promise((_r, rechazar) => {
        (init.signal as AbortSignal).addEventListener("abort", () => rechazar(Object.assign(new Error("abortado"), { name: "AbortError" })));
      })) as unknown as Fetcher;
    const inicio = Date.now();
    assert.equal(await leerComprobante("data:image/jpeg;base64,abc", { fetcher: colgado, env: ENV, plazoMs: 30 }), null);
    assert.ok(Date.now() - inicio < 1000);
  } finally {
    console.error = original;
  }
});

test("el texto viaja delimitado como dato, con la clave en el encabezado y no en el cuerpo", async () => {
  const llamadas: { url: string; cuerpo: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, cuerpo: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ output_text: json(true, 1000, "PYG", null) }), { status: 200 });
  }) as unknown as Fetcher;

  await leerComprobante("data:image/jpeg;base64,abc", { fetcher, env: ENV });

  const { url, cuerpo } = llamadas[0];
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.ok(!JSON.stringify(cuerpo).includes("sk-prueba"));
});

test("informa lo que costó leer la imagen", async () => {
  const env = { ...ENV, EOS_USD_POR_MTOK_ENTRADA: "5", EOS_USD_POR_MTOK_SALIDA: "30" };
  const fetcher = (async () =>
    new Response(
      JSON.stringify({ output_text: json(true, 1000, "PYG", null), usage: { input_tokens: 400, output_tokens: 20 } }),
      { status: 200 },
    )) as unknown as Fetcher;

  const costos: number[] = [];
  await leerComprobante("data:image/jpeg;base64,abc", { fetcher, env, alCosto: (usd) => costos.push(usd) });
  // 400 × 5 + 20 × 30, por millón.
  assert.deepEqual(costos.map((c) => Number(c.toFixed(6))), [0.0026]);
});
