import assert from "node:assert/strict";
import { test } from "node:test";

import { extensionDe, transcribirAudio } from "./transcribir-audio.ts";

test("extensionDe lee el formato real aunque el mime_type traiga parámetros", () => {
  assert.equal(extensionDe("audio/ogg; codecs=opus"), "ogg");
  assert.equal(extensionDe("audio/mp4"), "m4a");
  assert.equal(extensionDe("audio/mpeg"), "mp3");
  assert.equal(extensionDe("audio/wav"), "wav");
  assert.equal(extensionDe("audio/webm"), "webm");
});

test("extensionDe no distingue mayúsculas y usa ogg si no reconoce nada", () => {
  assert.equal(extensionDe("AUDIO/OGG; CODECS=OPUS"), "ogg");
  assert.equal(extensionDe("audio/x-caf"), "ogg");
});

test("un audio pide la duración a Whisper e informa lo que costó", async () => {
  const antes = process.env.OPENAI_API_KEY;
  const fetchOriginal = globalThis.fetch;
  process.env.OPENAI_API_KEY = "prueba";
  let formato: FormDataEntryValue | null = null;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    formato = (init?.body as FormData).get("response_format");
    return new Response(JSON.stringify({ text: " vendí dos camperas ", duration: 30 }), { status: 200 });
  }) as typeof fetch;

  try {
    const costos: number[] = [];
    const texto = await transcribirAudio(
      { nombre: "a.ogg", tipo: "audio/ogg", base64: "AAAA" },
      { alCosto: (usd) => costos.push(usd) },
    );
    assert.equal(texto, "vendí dos camperas");
    assert.equal(formato, "verbose_json");
    assert.deepEqual(costos, [0.003]);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (antes === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = antes;
  }
});
