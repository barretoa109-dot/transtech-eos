import assert from "node:assert/strict";
import test from "node:test";

import { transcribirAudioDeCliente } from "./audio-entrante.ts";

test("sin media_id no intenta bajar ni transcribir nada", async () => {
  const resultado = await transcribirAudioDeCliente("", "audio/ogg");
  assert.equal(resultado, null);
});
