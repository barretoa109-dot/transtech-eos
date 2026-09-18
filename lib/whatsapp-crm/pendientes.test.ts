import assert from "node:assert/strict";
import test from "node:test";

import { contarClientesEsperando } from "./pendientes.ts";

const AHORA = "2026-09-18T13:00:00Z";

test("un cliente que pidió una persona y nadie le contestó está esperando", () => {
  const r = contarClientesEsperando([{ contacto_id: "c1", creado_en: "2026-09-18T07:00:00Z" }], [], AHORA);
  assert.deepEqual(r, { cantidad: 1, masHoras: 6 });
});

test("si la empresa le escribió después, ya no espera", () => {
  const r = contarClientesEsperando(
    [{ contacto_id: "c1", creado_en: "2026-09-18T07:00:00Z" }],
    [{ contacto_id: "c1", ocurrio_en: "2026-09-18T08:00:00Z" }],
    AHORA,
  );
  assert.equal(r, null);
});

test("un envío ANTERIOR al pedido no lo contesta", () => {
  const r = contarClientesEsperando(
    [{ contacto_id: "c1", creado_en: "2026-09-18T07:00:00Z" }],
    [{ contacto_id: "c1", ocurrio_en: "2026-09-17T20:00:00Z" }],
    AHORA,
  );
  assert.equal(r?.cantidad, 1);
});

test("el envío a otro cliente no contesta a este", () => {
  const r = contarClientesEsperando(
    [{ contacto_id: "c1", creado_en: "2026-09-18T07:00:00Z" }],
    [{ contacto_id: "c2", ocurrio_en: "2026-09-18T08:00:00Z" }],
    AHORA,
  );
  assert.equal(r?.cantidad, 1);
});

test("varios pedidos del mismo cliente cuentan como un cliente, con la espera del más viejo", () => {
  const r = contarClientesEsperando(
    [
      { contacto_id: "c1", creado_en: "2026-09-18T11:00:00Z" },
      { contacto_id: "c1", creado_en: "2026-09-17T13:00:00Z" },
      { contacto_id: "c2", creado_en: "2026-09-18T12:00:00Z" },
    ],
    [],
    AHORA,
  );
  assert.deepEqual(r, { cantidad: 2, masHoras: 24 });
});

test("sin eventos, o con eventos sin cliente, no hay nadie esperando", () => {
  assert.equal(contarClientesEsperando([], [], AHORA), null);
  assert.equal(contarClientesEsperando([{ contacto_id: null, creado_en: "2026-09-18T07:00:00Z" }], [], AHORA), null);
});

test("una fecha ilegible no rompe", () => {
  assert.equal(contarClientesEsperando([{ contacto_id: "c1", creado_en: "no" }], [], AHORA), null);
  assert.equal(contarClientesEsperando([{ contacto_id: "c1", creado_en: AHORA }], [], "no"), null);
});
