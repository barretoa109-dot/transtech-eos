import assert from "node:assert/strict";
import test from "node:test";
import { correr, dentroDe, dias, periodoAnterior } from "./periodo.ts";

test("dias cuenta los dos extremos incluidos", () => {
  assert.equal(dias("2026-08-01", "2026-08-31"), 31);
  assert.equal(dias("2026-08-01", "2026-08-01"), 1);
});

test("correr suma y resta días en UTC, sin importar la zona horaria local", () => {
  assert.equal(correr("2026-08-01", 1), "2026-08-02");
  assert.equal(correr("2026-08-01", -1), "2026-07-31");
});

test("el período anterior es del mismo largo y termina justo antes", () => {
  // Agosto tiene 31 días: el anterior es julio 1 a 31, no julio 2 a 31.
  const anterior = periodoAnterior({ desde: "2026-08-01", hasta: "2026-08-31" });
  assert.deepEqual(anterior, { desde: "2026-07-01", hasta: "2026-07-31" });
});

test("dentroDe es inclusivo en los dos extremos", () => {
  const periodo = { desde: "2026-08-01", hasta: "2026-08-31" };
  assert.equal(dentroDe("2026-08-01", periodo), true);
  assert.equal(dentroDe("2026-08-31", periodo), true);
  assert.equal(dentroDe("2026-07-31", periodo), false);
  assert.equal(dentroDe("2026-09-01", periodo), false);
});
