import assert from "node:assert/strict";
import test from "node:test";
import { calcular } from "../motor.ts";
import {
  CARTERA_VENCIDA,
  CUENTAS_POR_COBRAR,
  CUENTAS_POR_PAGAR,
  DEFINICIONES_CARTERA,
  DIAS_DE_COBRO,
  DIAS_DE_PAGO,
} from "./cartera.ts";
import type { CompraHecho, Hechos, VentaHecho } from "../tipos.ts";

// "Hoy", para estas pruebas, es el final del período pedido.
const SEPTIEMBRE = { desde: "2026-09-01", hasta: "2026-09-30" };

function venta(p: Partial<VentaHecho> & { total: number }): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? "2026-08-15",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "emitida",
    contacto_id: null,
    contacto_nombre: null,
    total: p.total,
    vence_el: p.vence_el === undefined ? null : p.vence_el,
    cobrado: p.cobrado ?? 0,
    items: [],
  };
}

function compra(p: Partial<CompraHecho> & { total: number }): CompraHecho {
  return {
    id: p.id ?? "c1",
    fecha: p.fecha ?? "2026-08-15",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "registrada",
    proveedor_id: p.proveedor_id ?? null,
    proveedor_nombre: p.proveedor_nombre ?? null,
    total: p.total,
    vence_el: p.vence_el === undefined ? null : p.vence_el,
    cobrado: p.cobrado ?? 0,
  };
}

test("todas son instantaneas: una cuenta por cobrar es de hoy, no de un período", () => {
  for (const def of DEFINICIONES_CARTERA) assert.equal(def.instantanea, true);
});

test("los ids no se repiten", () => {
  const ids = DEFINICIONES_CARTERA.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("el saldo sale de total menos cobrado, no del estado", () => {
  // Una venta con la mitad abonada sigue en 'emitida'. Si se contara entera,
  // la cartera saldría inflada justo en los negocios que más usan crédito.
  const hechos: Hechos = {
    ventas: [venta({ id: "v1", total: 1_000_000, cobrado: 400_000 })],
  };
  const [r] = calcular([CUENTAS_POR_COBRAR], hechos, SEPTIEMBRE);
  assert.equal(r.valor, 600_000);
  assert.notEqual(r.valor, 1_000_000);
});

test("con todo cobrado la cartera es CERO, no 'sin datos'", () => {
  // Cero acá es una respuesta real y útil —"no te deben nada"— y distinta de
  // "no sé". Por eso la moneda sigue apareciendo con su valor en cero.
  const hechos: Hechos = {
    ventas: [venta({ id: "v1", total: 1_000_000, cobrado: 1_000_000, estado: "cobrada" })],
  };
  const [r] = calcular([CUENTAS_POR_COBRAR], hechos, SEPTIEMBRE);
  assert.equal(r.valor, 0);
  assert.equal(r.estado, "bien");
});

test("lo anulado no cuenta, aunque tenga saldo", () => {
  const hechos: Hechos = {
    ventas: [venta({ id: "v1", total: 500_000, estado: "anulada" })],
  };
  assert.deepEqual(calcular([CUENTAS_POR_COBRAR], hechos, SEPTIEMBRE), []);
});

test("cartera_vencida cuenta desde el vencimiento, no desde la fecha del documento", () => {
  const hechos: Hechos = {
    ventas: [
      // Emitida hace mucho pero vence en diciembre: NO está vencida.
      venta({ id: "corriente", total: 300_000, fecha: "2026-01-01", vence_el: "2026-12-01" }),
      // Venció el 15 de agosto: sí.
      venta({ id: "vencida", total: 200_000, vence_el: "2026-08-15" }),
    ],
  };
  const [r] = calcular([CARTERA_VENCIDA], hechos, SEPTIEMBRE);
  assert.equal(r.valor, 200_000);
});

test("sin vencimiento pactado NO se cuenta como vencido", () => {
  const hechos: Hechos = {
    ventas: [venta({ id: "v1", total: 900_000, vence_el: null })],
  };
  const [vencida] = calcular([CARTERA_VENCIDA], hechos, SEPTIEMBRE);
  const [porCobrar] = calcular([CUENTAS_POR_COBRAR], hechos, SEPTIEMBRE);

  // Está en la cartera, pero no se puede afirmar que esté atrasada.
  assert.equal(porCobrar.valor, 900_000);
  assert.equal(vencida.valor, 0);
});

test("cartera_vencida es menos_es_mejor: más vencido es peor", () => {
  assert.equal(CARTERA_VENCIDA.direccion, "menos_es_mejor");
  assert.equal(CUENTAS_POR_COBRAR.direccion, "neutro");
});

test("cuentas_por_pagar usa el mismo criterio del lado de las compras", () => {
  const hechos: Hechos = {
    compras: [
      compra({ id: "c1", total: 400_000, cobrado: 100_000 }),
      compra({ id: "c2", total: 100_000, cobrado: 100_000, estado: "pagada" }),
      compra({ id: "c3", total: 900_000, estado: "anulada" }),
    ],
  };
  const [r] = calcular([CUENTAS_POR_PAGAR], hechos, SEPTIEMBRE);
  assert.equal(r.valor, 300_000);
});

test("nunca se mezclan monedas", () => {
  const hechos: Hechos = {
    ventas: [
      venta({ id: "v1", total: 1_000_000, moneda: "PYG" }),
      venta({ id: "v2", total: 500, moneda: "USD" }),
    ],
  };
  const resultados = calcular([CUENTAS_POR_COBRAR], hechos, SEPTIEMBRE);
  assert.equal(resultados.find((r) => r.moneda === "PYG")?.valor, 1_000_000);
  assert.equal(resultados.find((r) => r.moneda === "USD")?.valor, 500);
});

test("sin ningún cobro, los días de cobro dicen por qué en vez de un cero", () => {
  const hechos: Hechos = { ventas: [venta({ id: "v1", total: 1_000_000, cobrado: 0 })] };
  const [r] = calcular([DIAS_DE_COBRO], hechos, SEPTIEMBRE);
  assert.equal(r.valor, null);
  assert.equal(r.falta, "Todavía no se cobró ninguna venta a crédito");
  assert.notEqual(r.valor, 0);
});

test("con cobros, los días de cobro salen de la fecha del documento", () => {
  const hechos: Hechos = {
    ventas: [venta({ id: "v1", fecha: "2026-09-01", total: 1_000_000, cobrado: 1_000_000, estado: "cobrada" })],
  };
  // Del 1 al 30 de septiembre: 29 días.
  const [r] = calcular([DIAS_DE_COBRO], hechos, SEPTIEMBRE);
  assert.equal(r.valor, 29);
});

test("los días de pago son neutros: pagar más tarde no es bueno ni malo sin plazo pactado", () => {
  assert.equal(DIAS_DE_PAGO.direccion, "neutro");
  const hechos: Hechos = {
    compras: [compra({ id: "c1", fecha: "2026-09-01", total: 500_000, cobrado: 500_000, estado: "pagada" })],
  };
  const [r] = calcular([DIAS_DE_PAGO], hechos, SEPTIEMBRE);
  assert.equal(r.valor, 29);
});
