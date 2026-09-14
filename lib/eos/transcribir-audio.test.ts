import assert from "node:assert/strict";
import { test } from "node:test";

import { extensionDe } from "./transcribir-audio.ts";

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
