import assert from "node:assert/strict";
import test from "node:test";

import { kudeIaHabilitada, leerKude, leerRespuestaKude, type Fetcher } from "./leerKude.ts";

const ENV = { EOS_FACTURAS_IA: "1", OPENAI_API_KEY: "sk-prueba" };

const json = (datos: Partial<Record<string, unknown>>) =>
  JSON.stringify({
    es_factura: true,
    ruc_emisor: null,
    razon_social_emisor: null,
    numero_documento: null,
    cdc: null,
    fecha: null,
    moneda: "PYG",
    total: null,
    iva_tasa: 0,
    ...datos,
  });

// ------------------------------------------------------------------ encendido

test("apagado por defecto: sin la variable no se lee nada", () => {
  assert.equal(kudeIaHabilitada({ OPENAI_API_KEY: "sk" }), false);
  assert.equal(kudeIaHabilitada({ EOS_FACTURAS_IA: "1" }), false);
  assert.equal(kudeIaHabilitada(ENV), true);
});

test("apagado, leerKude no sale a la red", async () => {
  let llamadas = 0;
  const fetcher = (async () => {
    llamadas += 1;
    return new Response(JSON.stringify({ output_text: json({ total: 100000 }) }), { status: 200 });
  }) as unknown as Fetcher;

  const r = await leerKude(
    { tipo: "texto", contenido: "FACTURA ELECTRÓNICA" },
    { fetcher, env: { OPENAI_API_KEY: "sk" } },
  );
  assert.equal(r, null);
  assert.equal(llamadas, 0);
});

test("texto vacío o imagen sin datos: ni sale a la red", async () => {
  let llamadas = 0;
  const fetcher = (async () => {
    llamadas += 1;
    return new Response(JSON.stringify({ output_text: json({ total: 1 }) }), { status: 200 });
  }) as unknown as Fetcher;

  assert.equal(await leerKude({ tipo: "texto", contenido: "   " }, { fetcher, env: ENV }), null);
  assert.equal(
    await leerKude({ tipo: "imagen", mime: "image/jpeg", base64: "" }, { fetcher, env: ENV }),
    null,
  );
  assert.equal(llamadas, 0);
});

// ----------------------------------------------------------------- la lectura

test("una factura clara: emisor, total, fecha y tasa", () => {
  assert.deepEqual(
    leerRespuestaKude({
      output_text: json({
        ruc_emisor: "80012345-6",
        razon_social_emisor: "Distribuidora Rossana S.A.",
        numero_documento: "001-001-0000123",
        cdc: "01800123456001001000012320261105123456789",
        fecha: "2026-11-05",
        total: 550000,
        iva_tasa: 10,
      }),
    }),
    {
      ruc_emisor: "80012345-6",
      razon_social_emisor: "Distribuidora Rossana S.A.",
      numero_documento: "001-001-0000123",
      cdc: "01800123456001001000012320261105123456789",
      fecha: "2026-11-05",
      moneda: "PYG",
      total: 550000,
      iva_tasa: 10,
    },
  );
});

test("sin moneda declarada, se asume guaraníes; tasa inválida cae a exenta", () => {
  assert.deepEqual(leerRespuestaKude({ output_text: json({ total: 50000, iva_tasa: 21 }) }), {
    ruc_emisor: null,
    razon_social_emisor: null,
    numero_documento: null,
    cdc: null,
    fecha: null,
    moneda: "PYG",
    total: 50000,
    iva_tasa: 0,
  });
});

test("dólares, cuando el modelo lo dice", () => {
  assert.equal(leerRespuestaKude({ output_text: json({ moneda: "USD", total: 20 }) })?.moneda, "USD");
});

test("una fecha con un formato raro se descarta, no se inventa", () => {
  assert.equal(
    leerRespuestaKude({ output_text: json({ total: 1000, fecha: "05/11/2026" }) })?.fecha,
    null,
  );
});

// ------------------------------------------------------- lo que nunca se acepta

test("no es una factura: null, aunque traiga un total", () => {
  assert.equal(leerRespuestaKude({ output_text: json({ es_factura: false, total: 139000 }) }), null);
});

test("un total que no se puede leer: null, nunca se inventa un número", () => {
  assert.equal(leerRespuestaKude({ output_text: json({ total: null }) }), null);
  assert.equal(leerRespuestaKude({ output_text: json({ total: 0 }) }), null);
  assert.equal(leerRespuestaKude({ output_text: json({ total: -500 }) }), null);
});

test("una respuesta rota o sin JSON: null", () => {
  assert.equal(leerRespuestaKude({ output_text: "no entendí el documento" }), null);
  assert.equal(leerRespuestaKude({ output_text: "{roto" }), null);
  assert.equal(leerRespuestaKude(null), null);
});

test("tolera el JSON con texto alrededor y la otra forma de la respuesta", () => {
  assert.equal(
    leerRespuestaKude({ output_text: `Acá está: ${json({ total: 75000 })} listo` })?.total,
    75000,
  );
  assert.equal(
    leerRespuestaKude({ output: [{ content: [{ text: json({ total: 10000 }) }] }] })?.total,
    10000,
  );
});

// ------------------------------------------------------------------ las caídas

test("si el proveedor falla, tarda o contesta cualquier cosa, no se inventa nada", async () => {
  const original = console.error;
  console.error = () => {};

  try {
    const entrada = { tipo: "texto", contenido: "FACTURA ELECTRÓNICA" } as const;

    const falla500 = (async () => new Response("", { status: 500 })) as unknown as Fetcher;
    assert.equal(await leerKude(entrada, { fetcher: falla500, env: ENV }), null);

    const basura = (async () =>
      new Response(JSON.stringify({ output_text: "esto no es json" }), { status: 200 })) as unknown as Fetcher;
    assert.equal(await leerKude(entrada, { fetcher: basura, env: ENV }), null);

    const roto = (async () => {
      throw new Error("red");
    }) as unknown as Fetcher;
    assert.equal(await leerKude(entrada, { fetcher: roto, env: ENV }), null);

    const colgado = ((_: string, init: RequestInit) =>
      new Promise((_r, rechazar) => {
        (init.signal as AbortSignal).addEventListener("abort", () =>
          rechazar(Object.assign(new Error("abortado"), { name: "AbortError" })),
        );
      })) as unknown as Fetcher;
    const inicio = Date.now();
    assert.equal(await leerKude(entrada, { fetcher: colgado, env: ENV, plazoMs: 30 }), null);
    assert.ok(Date.now() - inicio < 1000);
  } finally {
    console.error = original;
  }
});

test("el texto viaja delimitado como dato, con la clave en el encabezado y no en el cuerpo", async () => {
  const llamadas: { url: string; cuerpo: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, cuerpo: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ output_text: json({ total: 1000 }) }), { status: 200 });
  }) as unknown as Fetcher;

  await leerKude({ tipo: "imagen", mime: "image/jpeg", base64: "abc" }, { fetcher, env: ENV });

  const { url, cuerpo } = llamadas[0];
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.ok(!JSON.stringify(cuerpo).includes("sk-prueba"));
});

test("informa lo que costó leer el documento", async () => {
  const env = { ...ENV, EOS_USD_POR_MTOK_ENTRADA: "5", EOS_USD_POR_MTOK_SALIDA: "30" };
  const fetcher = (async () =>
    new Response(
      JSON.stringify({ output_text: json({ total: 1000 }), usage: { input_tokens: 400, output_tokens: 20 } }),
      { status: 200 },
    )) as unknown as Fetcher;

  const costos: number[] = [];
  await leerKude(
    { tipo: "texto", contenido: "FACTURA ELECTRÓNICA" },
    { fetcher, env, alCosto: (usd) => costos.push(usd) },
  );
  // 400 × 5 + 20 × 30, por millón.
  assert.deepEqual(costos.map((c) => Number(c.toFixed(6))), [0.0026]);
});
