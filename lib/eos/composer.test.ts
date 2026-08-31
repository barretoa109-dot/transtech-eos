import assert from "node:assert/strict";
import test from "node:test";

import { debeEnviarConEnter } from "./composer.ts";

test("Enter envía en escritorio", () => {
  assert.equal(
    debeEnviarConEnter({ key: "Enter", shiftKey: false, isComposing: false, esMovil: false }),
    true,
  );
});

test("Shift+Enter inserta un salto en escritorio", () => {
  assert.equal(
    debeEnviarConEnter({ key: "Enter", shiftKey: true, isComposing: false, esMovil: false }),
    false,
  );
});

test("Enter inserta un salto en móvil", () => {
  assert.equal(
    debeEnviarConEnter({ key: "Enter", shiftKey: false, isComposing: false, esMovil: true }),
    false,
  );
});

test("no envía mientras el teclado está componiendo texto", () => {
  assert.equal(
    debeEnviarConEnter({ key: "Enter", shiftKey: false, isComposing: true, esMovil: false }),
    false,
  );
});
