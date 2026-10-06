import assert from "node:assert/strict";
import { test } from "node:test";

import { barraPara } from "./barra-de-estado.ts";

test("tema claro: texto oscuro sobre fondo blanco", () => {
  assert.deepEqual(barraPara(false), { estilo: "DARK", fondo: "#ffffff" });
});

test("tema oscuro: texto claro sobre el fondo oscuro de la web", () => {
  assert.deepEqual(barraPara(true), { estilo: "LIGHT", fondo: "#0a0a0a" });
});
