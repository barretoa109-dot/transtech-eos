import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluarPrimerValor, type FilaPrimerValor } from "./primer-valor.ts";

const AHORA = Date.parse("2026-09-23T12:00:00Z");
const hace = (horas: number) => new Date(AHORA - horas * 3_600_000).toISOString();

function cuenta(id: string, registroHaceH: number, accionTrasH: number | null): FilaPrimerValor {
  return {
    usuario_id: id,
    registro: hace(registroHaceH),
    primera_accion_ok: accionTrasH === null ? null : hace(registroHaceH - accionTrasH),
  };
}

test("sin cuentas nuevas lo dice", () => {
  const r = evaluarPrimerValor([cuenta("viejo", 24 * 30, 1)], AHORA);
  assert.match(r.detalle, /ninguna cuenta real nueva/);
  assert.deepEqual(r.sinValor, []);
});

test("mide la mediana al primer valor y cuántas llegaron el primer día", () => {
  const r = evaluarPrimerValor(
    [cuenta("a", 48, 0.5), cuenta("b", 72, 2), cuenta("c", 100, 30)],
    AHORA,
  );
  assert.match(r.detalle, /3 cuenta\(s\)/);
  assert.match(r.detalle, /2 llegaron a una acción el primer día/);
  assert.match(r.detalle, /mediana al primer valor: 2,0 h/);
});

test("marca para intervenir a quien lleva más de 24 h sin una acción", () => {
  const r = evaluarPrimerValor(
    [cuenta("aaaaaaaa-1111", 30, null), cuenta("bbbbbbbb-2222", 5, null), cuenta("c", 50, 1)],
    AHORA,
  );
  assert.deepEqual(r.sinValor, ["aaaaaaaa-1111"]);
  assert.match(r.detalle, /INTERVENIR .*aaaaaaaa/);
  assert.ok(!r.detalle.includes("bbbbbbbb"), "la de 5 h todavía está a tiempo");
});

test("si nadie llegó todavía, no inventa una mediana", () => {
  const r = evaluarPrimerValor([cuenta("x", 10, null)], AHORA);
  assert.match(r.detalle, /ninguna llegó todavía/);
});

test("filas sin fecha de registro se ignoran", () => {
  const r = evaluarPrimerValor([{ usuario_id: "z", registro: null, primera_accion_ok: null }], AHORA);
  assert.match(r.detalle, /ninguna cuenta real nueva/);
});
