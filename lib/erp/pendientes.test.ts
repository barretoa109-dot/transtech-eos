import assert from "node:assert/strict";
import test from "node:test";

import { pendientes, vigentes } from "./pendientes.ts";

const doc = (estado: string, movimiento_id: string | null = null) => ({ estado, movimiento_id });

test("un documento anulado no es deuda aunque no tenga movimiento", () => {
  const docs = [doc("anulada"), doc("anulada")];

  assert.equal(pendientes(docs).length, 0);
  assert.equal(vigentes(docs).length, 0);
});

test("lo que no se pagó sí es pendiente", () => {
  assert.equal(pendientes([doc("registrada"), doc("emitida"), doc("borrador")]).length, 3);
});

test("lo saldado o con movimiento de caja no es pendiente", () => {
  assert.equal(pendientes([doc("pagada"), doc("cobrada"), doc("registrada", "mov-1")]).length, 0);
});

test("mezcla: solo cuenta lo vivo y sin pagar", () => {
  const docs = [doc("anulada"), doc("registrada"), doc("registrada", "mov-1"), doc("pagada")];

  assert.equal(vigentes(docs).length, 3);
  assert.equal(pendientes(docs).length, 1);
});
