import assert from "node:assert/strict";
import test from "node:test";
import {
  antiguedad,
  diasDeAtraso,
  diasPromedioDeCobro,
  estaPendiente,
  saldoDe,
  tramoDe,
  vencidos,
  type DocumentoCartera,
} from "./cartera.ts";

const HOY = "2026-09-02";

function doc(p: Partial<DocumentoCartera> & { id: string }): DocumentoCartera {
  return {
    id: p.id,
    fecha: p.fecha ?? "2026-08-01",
    vence_el: p.vence_el === undefined ? "2026-08-31" : p.vence_el,
    moneda: p.moneda ?? "PYG",
    total: p.total ?? 1_000_000,
    cobrado: p.cobrado ?? 0,
    contacto_id: p.contacto_id ?? null,
    contacto_nombre: p.contacto_nombre ?? null,
  };
}

test("el saldo es lo que falta cobrar, nunca negativo", () => {
  assert.equal(saldoDe(doc({ id: "a", total: 1000, cobrado: 400 })), 600);
  assert.equal(saldoDe(doc({ id: "b", total: 1000, cobrado: 1500 })), 0);
});

test("un saldo de un guaraní no cuenta como pendiente: PYG no lleva decimales", () => {
  assert.equal(estaPendiente(doc({ id: "a", total: 1000, cobrado: 999 })), false);
  assert.equal(estaPendiente(doc({ id: "b", total: 1000, cobrado: 900 })), true);
});

test("una factura a 60 días emitida hace 45 NO está atrasada", () => {
  // Vence el 30 de septiembre; hoy es 2 de septiembre.
  const d = doc({ id: "a", fecha: "2026-08-01", vence_el: "2026-09-30" });
  assert.equal(tramoDe(d, HOY), "corriente");
});

test("el tramo se cuenta desde el vencimiento, no desde la fecha del documento", () => {
  // Emitida hace mucho pero vencida hace 2 días.
  assert.equal(tramoDe(doc({ id: "a", fecha: "2026-01-01", vence_el: "2026-08-31" }), HOY), "1-30");
  assert.equal(tramoDe(doc({ id: "b", vence_el: "2026-07-15" }), HOY), "31-60");
  assert.equal(tramoDe(doc({ id: "c", vence_el: "2026-06-15" }), HOY), "61-90");
  assert.equal(tramoDe(doc({ id: "d", vence_el: "2026-01-01" }), HOY), "mas-90");
});

test("sin vencimiento pactado no se puede afirmar que esté atrasado", () => {
  assert.equal(tramoDe(doc({ id: "a", vence_el: null }), HOY), "sin-vencimiento");
  assert.equal(diasDeAtraso(doc({ id: "a", vence_el: null }), HOY), null);
});

test("la antigüedad solo cuenta lo que tiene saldo: lo cobrado no es cartera", () => {
  const a = antiguedad(
    [
      doc({ id: "a", total: 1000, cobrado: 0, vence_el: "2026-08-01" }),
      doc({ id: "b", total: 1000, cobrado: 1000, vence_el: "2026-08-01" }),
    ],
    "PYG",
    HOY,
  );
  assert.equal(a.total, 1000);
  assert.equal(a.lineas.reduce((s, l) => s + l.documentos, 0), 1);
});

test("lo 'sin vencimiento' NO se suma como vencido", () => {
  const a = antiguedad(
    [
      doc({ id: "a", total: 500, vence_el: null }),
      doc({ id: "b", total: 300, vence_el: "2026-08-01" }), // vencido
      doc({ id: "c", total: 200, vence_el: "2026-12-01" }), // corriente
    ],
    "PYG",
    HOY,
  );
  assert.equal(a.total, 1000);
  assert.equal(a.vencido, 300);
  assert.notEqual(a.vencido, 800);
});

test("nunca se mezclan monedas", () => {
  const a = antiguedad(
    [doc({ id: "a", total: 1000, moneda: "PYG" }), doc({ id: "b", total: 50, moneda: "USD" })],
    "PYG",
    HOY,
  );
  assert.equal(a.total, 1000);
});

test("los tramos salen en orden de antigüedad, no alfabético", () => {
  const a = antiguedad(
    [
      doc({ id: "a", vence_el: "2026-01-01" }),
      doc({ id: "b", vence_el: "2026-12-01" }),
      doc({ id: "c", vence_el: "2026-08-25" }),
    ],
    "PYG",
    HOY,
  );
  assert.deepEqual(a.lineas.map((l) => l.tramo), ["corriente", "1-30", "mas-90"]);
});

test("los vencidos salen del más viejo al más nuevo: a quién llamar primero", () => {
  const lista = vencidos(
    [
      doc({ id: "nuevo", vence_el: "2026-08-30" }),
      doc({ id: "viejo", vence_el: "2026-05-01" }),
      doc({ id: "futuro", vence_el: "2026-12-01" }),
      doc({ id: "sin", vence_el: null }),
    ],
    HOY,
  );
  assert.deepEqual(lista.map((d) => d.id), ["viejo", "nuevo"]);
});

test("el DSO pondera por monto: cobrar mucho tarde pesa más que cobrar poco temprano", () => {
  const d = diasPromedioDeCobro(
    [
      { fechaDocumento: "2026-08-01", fechaCobro: "2026-08-31", monto: 10_000_000, moneda: "PYG" }, // 30 días
      { fechaDocumento: "2026-08-01", fechaCobro: "2026-08-06", monto: 100_000, moneda: "PYG" }, // 5 días
    ],
    "PYG",
  );
  // Ponderado ≈ 29.8, no el promedio simple 17.5.
  assert.ok(d !== null && d > 29 && d < 30, `dio ${d}`);
  assert.notEqual(d, 17.5);
});

test("sin cobros el DSO es null, no cero: cero diría que te pagan el mismo día", () => {
  assert.equal(diasPromedioDeCobro([], "PYG"), null);
  assert.notEqual(diasPromedioDeCobro([], "PYG"), 0);
});

test("un cobro anterior al documento no produce días negativos", () => {
  const d = diasPromedioDeCobro(
    [{ fechaDocumento: "2026-08-10", fechaCobro: "2026-08-01", monto: 1000, moneda: "PYG" }],
    "PYG",
  );
  assert.equal(d, 0);
});

test("el DSO tampoco mezcla monedas", () => {
  const d = diasPromedioDeCobro(
    [
      { fechaDocumento: "2026-08-01", fechaCobro: "2026-08-11", monto: 1000, moneda: "PYG" },
      { fechaDocumento: "2026-08-01", fechaCobro: "2026-08-31", monto: 1000, moneda: "USD" },
    ],
    "PYG",
  );
  assert.equal(d, 10);
});
