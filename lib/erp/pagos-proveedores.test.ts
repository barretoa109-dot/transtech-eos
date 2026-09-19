import assert from "node:assert/strict";
import test from "node:test";

import { pagosAProveedores, redactarPagos, saldoDeCompra, type CompraAPagar } from "./pagos-proveedores.ts";
import { formatearMonto } from "../finanzas/formato.ts";

const HOY = "2026-09-19";

function compra(p: Partial<CompraAPagar> & { id: string }): CompraAPagar {
  return { total: 100_000, pagado: 0, moneda: "PYG", vence_el: "2026-09-22", ...p };
}

test("una compra sin vencimiento NO genera aviso: no hay plazo que incumplir", () => {
  assert.deepEqual(pagosAProveedores(HOY, [compra({ id: "a", vence_el: null })]), []);
});

test("lo vencido se cuenta con su atraso, por el saldo", () => {
  const r = pagosAProveedores(HOY, [
    compra({ id: "a", vence_el: "2026-09-14", total: 300_000, pagado: 100_000 }),
    compra({ id: "b", vence_el: "2026-09-17", total: 50_000 }),
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].vencidos, { cantidad: 2, total: 250_000, dias_de_la_mas_vieja: 5 });
  assert.equal(r[0].por_vencer.cantidad, 0);
});

test("lo que vence en los próximos 7 días (incluido hoy) es 'por vencer'", () => {
  const r = pagosAProveedores(HOY, [
    compra({ id: "hoy", vence_el: "2026-09-19", total: 10_000 }),
    compra({ id: "juev", vence_el: "2026-09-22", total: 20_000 }),
    compra({ id: "limite", vence_el: "2026-09-26", total: 30_000 }),
  ]);
  assert.equal(r[0].por_vencer.cantidad, 3);
  assert.equal(r[0].por_vencer.total, 60_000);
  assert.equal(r[0].por_vencer.dias_hasta_el_primero, 0);
  assert.equal(r[0].por_vencer.primer_vencimiento, "2026-09-19");
  assert.equal(r[0].vencidos.cantidad, 0);
});

test("lo que vence más allá de 7 días todavía no es noticia", () => {
  assert.deepEqual(pagosAProveedores(HOY, [compra({ id: "a", vence_el: "2026-09-27" })]), []);
});

test("una compra ya pagada del todo no cuenta, aunque haya vencido", () => {
  assert.deepEqual(
    pagosAProveedores(HOY, [compra({ id: "a", vence_el: "2026-09-10", total: 100_000, pagado: 100_000 })]),
    [],
  );
  assert.equal(saldoDeCompra({ total: 100_000, pagado: 150_000 }), 0);
});

test("por moneda y sin convertir", () => {
  const r = pagosAProveedores(HOY, [
    compra({ id: "g", vence_el: "2026-09-10", total: 500_000 }),
    compra({ id: "d", vence_el: "2026-09-10", total: 100, moneda: "USD" }),
  ]);
  assert.deepEqual(
    r.map((x) => [x.moneda, x.vencidos.total]),
    [["PYG", 500_000], ["USD", 100]],
  );
});

test("los ids salen ordenados: la misma lista da la misma clave", () => {
  const a = pagosAProveedores(HOY, [compra({ id: "z" }), compra({ id: "a" })]);
  const b = pagosAProveedores(HOY, [compra({ id: "a" }), compra({ id: "z" })]);
  assert.deepEqual(a[0].ids, ["a", "z"]);
  assert.deepEqual(a[0].ids, b[0].ids);
});

test("datos raros no rompen: fechas mal formadas, totales no numéricos", () => {
  assert.deepEqual(
    pagosAProveedores(HOY, [
      compra({ id: "a", vence_el: "18/09/2026" }),
      compra({ id: "b", total: Number.NaN }),
    ]),
    [],
  );
});

test("el texto dice cuánto, a quién le importa y cuándo", () => {
  const solo = pagosAProveedores(HOY, [compra({ id: "a", vence_el: "2026-09-14", total: 300_000 })])[0];
  assert.match(redactarPagos(solo, formatearMonto), /Tenés 1 pago a un proveedor vencido, por .*300\.000.*el más viejo lleva 5 días de atraso\./);

  const proximo = pagosAProveedores(HOY, [compra({ id: "b", vence_el: "2026-09-22", total: 200_000 })])[0];
  assert.match(redactarPagos(proximo, formatearMonto), /^1 pago vence en los próximos 7 días, por .*200\.000.*el primero, el 22\/09\.$/);

  const ambos = pagosAProveedores(HOY, [
    compra({ id: "a", vence_el: "2026-09-18", total: 100_000 }),
    compra({ id: "b", vence_el: "2026-09-19", total: 50_000 }),
    compra({ id: "c", vence_el: "2026-09-21", total: 70_000 }),
  ])[0];
  const t = redactarPagos(ambos, formatearMonto);
  assert.match(t, /Tenés 1 pago a un proveedor vencido/);
  assert.match(t, /Además, 2 pagos vencen en los próximos 7 días/);
  assert.match(t, /el primero, hoy\./);
});
