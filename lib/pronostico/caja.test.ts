import { test } from "node:test";
import assert from "node:assert/strict";

import { primerDiaEnRojo, proyectarCaja, TRAMOS } from "./caja.ts";
import type { CompraHecho, FijoHecho, VentaHecho } from "../kpi/tipos.ts";

const HOY = "2026-09-03";

function dia(n: number): string {
  return new Date(Date.parse(`${HOY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function venta(p: Partial<VentaHecho> = {}): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? HOY,
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "emitida",
    contacto_id: null,
    contacto_nombre: null,
    total: p.total ?? 1_000_000,
    // `??` se tragaría un null explícito, y "sin vencimiento" es justo uno de
    // los casos que hay que poder probar.
    vence_el: "vence_el" in p ? (p.vence_el ?? null) : dia(15),
    cobrado: p.cobrado ?? 0,
    items: [],
  };
}

function compra(p: Partial<CompraHecho> = {}): CompraHecho {
  return {
    id: p.id ?? "c1",
    fecha: p.fecha ?? HOY,
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "registrada",
    proveedor_id: null,
    proveedor_nombre: null,
    total: p.total ?? 400_000,
    vence_el: "vence_el" in p ? (p.vence_el ?? null) : dia(10),
    cobrado: p.cobrado ?? 0,
  };
}

function fijo(p: Partial<FijoHecho> = {}): FijoHecho {
  return { moneda: p.moneda ?? "PYG", monto: p.monto ?? 300_000, tipo: p.tipo ?? "gasto" };
}

function sola(args: Parameters<typeof proyectarCaja>[0]) {
  const r = proyectarCaja(args);
  assert.equal(r.length, 1, "se esperaba una sola moneda");
  return r[0];
}

// ---------------------------------------------------------------------------
// Ubicar en el tiempo
// ---------------------------------------------------------------------------

test("una venta que vence dentro del tramo entra en ese tramo", () => {
  const p = sola({ ventas: [venta({ vence_el: dia(15), total: 1_000_000 })], compras: [], fijos: [], hoy: HOY });
  assert.equal(p.tramos[0].entradas, 1_000_000);
});

test("una venta a 45 días no está en el tramo de 30 pero sí en el de 60", () => {
  const p = sola({ ventas: [venta({ vence_el: dia(45), total: 900_000 })], compras: [], fijos: [], hoy: HOY });
  assert.equal(p.tramos[0].entradas, 0);
  assert.equal(p.tramos[1].entradas, 900_000);
  assert.equal(p.tramos[2].entradas, 900_000, "los tramos son acumulados");
});

test("una venta más allá de los 90 días no entra en ningún tramo", () => {
  const p = sola({ ventas: [venta({ vence_el: dia(120) })], compras: [], fijos: [], hoy: HOY });
  assert.equal(p.tramos[2].entradas, 0);
});

test("lo que vence hoy cuenta y además aparece en el detalle", () => {
  const p = sola({ ventas: [venta({ vence_el: HOY, total: 500_000 })], compras: [], fijos: [], hoy: HOY });
  assert.equal(p.tramos[0].entradas, 500_000);
  assert.equal(p.tramos[0].partidas.length, 1, "estaba en el total pero no en el detalle");
});

// ---------------------------------------------------------------------------
// Lo vencido: la regla que hace que el número sirva
// ---------------------------------------------------------------------------

test("una venta vencida sin cobrar NO se cuenta como que va a entrar", () => {
  const p = sola({
    ventas: [venta({ vence_el: dia(-40), total: 5_000_000 })],
    compras: [],
    fijos: [],
    hoy: HOY,
  });

  assert.equal(p.tramos[0].entradas, 0);
  assert.notEqual(p.tramos[0].entradas, 5_000_000, "se contó plata que ya demostró que no entra");
  assert.equal(p.vencido_sin_cobrar, 5_000_000, "tampoco se puede esconder: va aparte");
  assert.equal(p.vencido_documentos, 1);
});

test("lo vencido se avisa en faltantes con sus palabras", () => {
  const p = sola({ ventas: [venta({ vence_el: dia(-5) })], compras: [], fijos: [], hoy: HOY });
  assert.ok(p.faltantes.some((f) => f.includes("ya no entró cuando debía")));
});

test("una compra vencida sin pagar tampoco se cuenta como salida futura", () => {
  const p = sola({ ventas: [], compras: [compra({ vence_el: dia(-20), total: 800_000 })], fijos: [], hoy: HOY });
  assert.equal(p.tramos[2].salidas, 0);
  assert.equal(p.vencido_sin_pagar, 800_000);
});

test("sin vencimiento no se ubica en el tiempo y se dice", () => {
  const p = sola({ ventas: [venta({ vence_el: null, total: 700_000 })], compras: [], fijos: [], hoy: HOY });
  assert.equal(p.tramos[2].entradas, 0);
  assert.equal(p.vencido_sin_cobrar, 0, "sin vencimiento no es lo mismo que vencido");
  assert.ok(p.faltantes.some((f) => f.includes("no tiene vencimiento")));
});

// ---------------------------------------------------------------------------
// Qué es plata y qué no
// ---------------------------------------------------------------------------

test("solo se proyecta el saldo, no el total, cuando hay un cobro parcial", () => {
  const p = sola({
    ventas: [venta({ total: 1_000_000, cobrado: 600_000, vence_el: dia(10) })],
    compras: [],
    fijos: [],
    hoy: HOY,
  });
  assert.equal(p.tramos[0].entradas, 400_000);
  assert.notEqual(p.tramos[0].entradas, 1_000_000, "se proyectó plata que ya está cobrada");
});

test("anuladas, borradores y ya cobradas no aportan flujo futuro", () => {
  for (const estado of ["anulada", "borrador", "cobrada"] as const) {
    const p = sola({ ventas: [venta({ estado, total: 2_000_000 })], compras: [], fijos: [], hoy: HOY });
    assert.equal(p.tramos[2].entradas, 0, `una venta ${estado} no es flujo futuro`);
  }
});

// ---------------------------------------------------------------------------
// Fijos
// ---------------------------------------------------------------------------

test("un gasto fijo se repite una vez por mes en los 90 días", () => {
  const p = sola({ ventas: [], compras: [], fijos: [fijo({ monto: 300_000 })], hoy: HOY });
  assert.equal(p.tramos[0].salidas, 300_000);
  assert.equal(p.tramos[1].salidas, 600_000);
  assert.equal(p.tramos[2].salidas, 900_000);
  assert.notEqual(p.tramos[2].salidas, 300_000, "el fijo se cobró una sola vez en 90 días");
});

test("el fijo viaja como esperado, no como comprometido", () => {
  const p = sola({ ventas: [venta()], compras: [], fijos: [fijo()], hoy: HOY });
  const porCerteza = new Map(p.tramos[0].partidas.map((x) => [x.origen, x.certeza]));
  assert.equal(porCerteza.get("fijo"), "esperado");
  assert.equal(porCerteza.get("venta"), "comprometido");
});

test("un fijo en cero no ensucia el detalle", () => {
  const p = sola({ ventas: [], compras: [], fijos: [fijo({ monto: 0 })], hoy: HOY });
  assert.equal(p.tramos[2].partidas.length, 0);
});

// ---------------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------------

test("sin saldo inicial se proyecta el flujo pero no el nivel de caja", () => {
  const p = sola({ ventas: [venta()], compras: [], fijos: [], hoy: HOY });
  assert.equal(p.saldo_inicial, null);
  assert.equal(p.tramos[0].saldo_proyectado, null);
  assert.ok(p.tramos[0].neto > 0, "el flujo sí se puede proyectar");
  assert.ok(p.faltantes.some((f) => f.includes("disponible de hoy")));
});

test("con saldo inicial el saldo proyectado lo arrastra", () => {
  const p = sola({
    ventas: [venta({ total: 1_000_000, vence_el: dia(10) })],
    compras: [compra({ total: 400_000, vence_el: dia(20) })],
    fijos: [],
    hoy: HOY,
    saldos: { PYG: 2_000_000 },
  });
  assert.equal(p.tramos[0].saldo_proyectado, 2_600_000);
});

test("un saldo inicial de cero no es lo mismo que no saber el saldo", () => {
  const p = sola({ ventas: [], compras: [], fijos: [], hoy: HOY, saldos: { PYG: 0 } });
  assert.equal(p.saldo_inicial, 0);
  assert.equal(p.tramos[0].saldo_proyectado, 0);
  assert.equal(p.faltantes.length, 0);
});

// ---------------------------------------------------------------------------
// Monedas
// ---------------------------------------------------------------------------

test("cada moneda se proyecta por separado y nunca se suman", () => {
  const r = proyectarCaja({
    ventas: [venta({ id: "a", moneda: "PYG", total: 1_000_000 }), venta({ id: "b", moneda: "USD", total: 500 })],
    compras: [],
    fijos: [],
    hoy: HOY,
  });

  assert.equal(r.length, 2);
  const pyg = r.find((x) => x.moneda === "PYG");
  const usd = r.find((x) => x.moneda === "USD");
  assert.equal(pyg?.tramos[0].entradas, 1_000_000);
  assert.equal(usd?.tramos[0].entradas, 500);
});

// ---------------------------------------------------------------------------
// Rojo
// ---------------------------------------------------------------------------

test("avisa el primer día en rojo", () => {
  const p = sola({
    ventas: [],
    compras: [compra({ total: 1_500_000, vence_el: dia(20) })],
    fijos: [],
    hoy: HOY,
    saldos: { PYG: 1_000_000 },
  });
  assert.deepEqual(primerDiaEnRojo(p), { fecha: dia(20), saldo: -500_000 });
});

test("sin saldo inicial no se puede afirmar que no hay rojo", () => {
  const p = sola({ ventas: [], compras: [compra({ total: 9_000_000 })], fijos: [], hoy: HOY });
  assert.equal(primerDiaEnRojo(p), null);
  assert.equal(p.saldo_inicial, null, "es 'no se sabe', no 'no hay riesgo'");
});

test("no marca rojo cuando la caja aguanta", () => {
  const p = sola({
    ventas: [venta({ total: 5_000_000, vence_el: dia(5) })],
    compras: [],
    fijos: [],
    hoy: HOY,
    saldos: { PYG: 1_000_000 },
  });
  assert.equal(primerDiaEnRojo(p), null);
});

// ---------------------------------------------------------------------------
// Cuadre: el detalle tiene que sumar el total
// ---------------------------------------------------------------------------

test("las partidas de los tres tramos suman exactamente el acumulado a 90", () => {
  const p = sola({
    ventas: [
      venta({ id: "a", vence_el: HOY, total: 100_000 }),
      venta({ id: "b", vence_el: dia(29), total: 200_000 }),
      venta({ id: "c", vence_el: dia(31), total: 300_000 }),
      venta({ id: "d", vence_el: dia(89), total: 400_000 }),
    ],
    compras: [compra({ total: 50_000, vence_el: dia(45) })],
    fijos: [fijo({ monto: 10_000 })],
    hoy: HOY,
  });

  const detalle = p.tramos.flatMap((t) => t.partidas);
  const netoDetalle = detalle.reduce((s, x) => s + x.monto, 0);

  assert.equal(netoDetalle, p.tramos[2].neto, "el desglose no suma el total del pronóstico");
  assert.equal(detalle.filter((x) => x.origen === "fijo").length, 3, "un fijo, una vez por mes");
  assert.equal(
    new Set(detalle.map((x) => x.documento_id).filter(Boolean)).size,
    5,
    "ningún documento puede aparecer en dos tramos a la vez",
  );
});

test("los tramos son los tres de siempre", () => {
  assert.deepEqual([...TRAMOS], [30, 60, 90]);
});
