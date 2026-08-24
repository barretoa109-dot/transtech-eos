import assert from "node:assert/strict";
import { test } from "node:test";

import { hoyEnParaguay, sumarDias } from "./fecha.ts";

test("a las 23:30 de Paraguay todavía es hoy, aunque UTC ya sea mañana", () => {
  // 2026-08-24 02:30 UTC = 2026-08-23 22:30 en Asunción (UTC-4).
  // Este es exactamente el caso que rompió cuatro veces: `toISOString()`
  // habría devuelto el 24.
  const momento = new Date("2026-08-24T02:30:00Z");

  assert.equal(momento.toISOString().slice(0, 10), "2026-08-24");
  assert.equal(hoyEnParaguay(momento), "2026-08-23");
});

test("al mediodía las dos zonas coinciden", () => {
  assert.equal(hoyEnParaguay(new Date("2026-08-24T15:00:00Z")), "2026-08-24");
});

test("sumarDias cruza el fin de mes", () => {
  assert.equal(sumarDias("2026-08-30", 3), "2026-09-02");
});

test("sumarDias cruza el fin de año hacia atrás", () => {
  assert.equal(sumarDias("2027-01-01", -1), "2026-12-31");
});

test("sumarDias respeta el 29 de febrero de un bisiesto", () => {
  assert.equal(sumarDias("2028-02-28", 1), "2028-02-29");
});
