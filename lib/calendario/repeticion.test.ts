import assert from "node:assert/strict";
import test from "node:test";

import { esRepeticion, ocurrencias } from "./repeticion.ts";

test("mensual: 'el 25 de cada mes' cae el 25 de cada mes del rango", () => {
  const dias = ocurrencias({ fecha: "2026-09-25", repite: "mensual", hasta: null }, "2026-09-01", "2027-01-31");
  assert.deepEqual(dias, ["2026-09-25", "2026-10-25", "2026-11-25", "2026-12-25", "2027-01-25"]);
});

test("nunca hay una ocurrencia anterior a la primera", () => {
  const dias = ocurrencias({ fecha: "2026-09-25", repite: "mensual", hasta: null }, "2026-01-01", "2026-10-31");
  assert.deepEqual(dias, ["2026-09-25", "2026-10-25"]);
});

test("mirar un mes lejano da la ocurrencia de ese mes (no depende de haber mirado los anteriores)", () => {
  const dias = ocurrencias({ fecha: "2026-09-25", repite: "mensual", hasta: null }, "2028-03-01", "2028-03-31");
  assert.deepEqual(dias, ["2028-03-25"]);
});

test("mensual anclado al 31: febrero cae el último día y marzo vuelve al 31", () => {
  const dias = ocurrencias({ fecha: "2026-01-31", repite: "mensual", hasta: null }, "2026-01-01", "2026-05-31");
  // Si se encadenara desde la ocurrencia anterior, marzo quedaría en el 28.
  assert.deepEqual(dias, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
});

test("mensual en un año bisiesto: febrero llega al 29", () => {
  const dias = ocurrencias({ fecha: "2028-01-31", repite: "mensual", hasta: null }, "2028-02-01", "2028-02-29");
  assert.deepEqual(dias, ["2028-02-29"]);
});

test("una serie con fin no pasa de la fecha 'hasta', inclusive", () => {
  const dias = ocurrencias({ fecha: "2026-09-25", repite: "mensual", hasta: "2026-11-25" }, "2026-09-01", "2027-03-31");
  assert.deepEqual(dias, ["2026-09-25", "2026-10-25", "2026-11-25"]);
});

test("semanal: cada 7 días desde el día de la primera ocurrencia", () => {
  // 2026-09-28 es lunes.
  const dias = ocurrencias({ fecha: "2026-09-28", repite: "semanal", hasta: null }, "2026-10-01", "2026-10-31");
  assert.deepEqual(dias, ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  for (const d of dias) assert.equal(new Date(`${d}T00:00:00Z`).getUTCDay(), 1);
});

test("diaria: un día por día, y respeta el rango", () => {
  const dias = ocurrencias({ fecha: "2026-09-20", repite: "diaria", hasta: null }, "2026-09-22", "2026-09-24");
  assert.deepEqual(dias, ["2026-09-22", "2026-09-23", "2026-09-24"]);
});

test("anual: mismo día del año; el 29 de febrero cae el 28 en los años comunes", () => {
  assert.deepEqual(
    ocurrencias({ fecha: "2026-09-25", repite: "anual", hasta: null }, "2026-01-01", "2029-12-31"),
    ["2026-09-25", "2027-09-25", "2028-09-25", "2029-09-25"],
  );
  assert.deepEqual(
    ocurrencias({ fecha: "2028-02-29", repite: "anual", hasta: null }, "2028-01-01", "2030-12-31"),
    ["2028-02-29", "2029-02-28", "2030-02-28"],
  );
});

test("un rango vacío o anterior a la serie no devuelve nada", () => {
  assert.deepEqual(ocurrencias({ fecha: "2026-09-25", repite: "mensual", hasta: null }, "2026-01-01", "2026-08-31"), []);
  assert.deepEqual(ocurrencias({ fecha: "2026-09-25", repite: "mensual", hasta: "2026-09-01" }, "2026-01-01", "2026-12-31"), []);
  assert.deepEqual(ocurrencias({ fecha: "2026-09-25", repite: "mensual", hasta: null }, "2026-10-31", "2026-10-01"), []);
});

test("una regla diaria sin fin no inunda la pantalla", () => {
  const dias = ocurrencias({ fecha: "2020-01-01", repite: "diaria", hasta: null }, "2020-01-01", "2030-12-31");
  assert.equal(dias.length, 400);
});

test("esRepeticion solo acepta las cuatro que la base también acepta", () => {
  for (const r of ["diaria", "semanal", "mensual", "anual"]) assert.equal(esRepeticion(r), true);
  for (const r of ["cada_mes", "Mensual", "", null, undefined, 5]) assert.equal(esRepeticion(r), false);
});
