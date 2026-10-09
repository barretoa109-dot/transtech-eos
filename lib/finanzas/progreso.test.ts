import assert from "node:assert/strict";
import { test } from "node:test";

import { diasDeProgreso } from "./progreso.ts";

const HOY = "2026-10-09";

test("14 días, del más viejo al más nuevo, terminando hoy", () => {
  const dias = diasDeProgreso([], HOY);
  assert.equal(dias.length, 14);
  assert.equal(dias[0].fecha, "2026-09-26");
  assert.equal(dias[13].fecha, "2026-10-09");
});

test("solo el último día se marca esHoy", () => {
  const dias = diasDeProgreso([], HOY);
  assert.equal(dias.filter((d) => d.esHoy).length, 1);
  assert.equal(dias[13].esHoy, true);
});

test("un día sin ninguna acción entra con cantidad 0, no se omite", () => {
  const dias = diasDeProgreso([], HOY);
  assert.ok(dias.every((d) => d.cantidad === 0));
});

test("cuenta por fecha de Paraguay, no de UTC", () => {
  // 2026-10-05 23:30 America/Asuncion (UTC-3) = 2026-10-06 02:30 UTC.
  const dias = diasDeProgreso(["2026-10-06T02:30:00Z"], HOY);
  const d5 = dias.find((d) => d.fecha === "2026-10-05");
  const d6 = dias.find((d) => d.fecha === "2026-10-06");
  assert.equal(d5?.cantidad, 1);
  assert.equal(d6?.cantidad, 0);
});

test("varias acciones el mismo día de Paraguay se suman", () => {
  const dias = diasDeProgreso(
    ["2026-10-08T12:00:00Z", "2026-10-08T15:00:00Z", "2026-10-08T23:59:00Z"],
    HOY,
  );
  const d8 = dias.find((d) => d.fecha === "2026-10-08");
  assert.equal(d8?.cantidad, 3);
});

test("una acción fuera de la ventana de 14 días no aparece", () => {
  const dias = diasDeProgreso(["2026-09-01T12:00:00Z"], HOY);
  assert.ok(dias.every((d) => d.cantidad === 0));
});
