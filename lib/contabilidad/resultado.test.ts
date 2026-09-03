import test from "node:test";
import assert from "node:assert/strict";

import { NO_ES_PARA_LA_SET, estadoDeResultados, margenOperativo } from "./resultado.ts";
import type {
  FijoHecho,
  Hechos,
  ItemVentaHecho,
  MovimientoHecho,
  MovimientoStockHecho,
  Periodo,
  VentaHecho,
} from "../kpi/tipos.ts";

const PERIODO: Periodo = { desde: "2026-09-01", hasta: "2026-09-30" };

function item(p: Partial<ItemVentaHecho> = {}): ItemVentaHecho {
  return {
    total: p.total ?? 1_100_000,
    iva: p.iva ?? 10,
    cantidad: p.cantidad ?? 1,
    costo_unitario: p.costo_unitario ?? null,
    producto_id: p.producto_id ?? "p1",
  };
}

function venta(p: Partial<VentaHecho> = {}): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? "2026-09-10",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "emitida",
    contacto_id: null,
    contacto_nombre: null,
    total: p.total ?? 1_100_000,
    vence_el: null,
    cobrado: 0,
    items: p.items ?? [item()],
  };
}

function gasto(p: Partial<MovimientoHecho> = {}): MovimientoHecho {
  return {
    fecha: p.fecha ?? "2026-09-15",
    moneda: p.moneda ?? "PYG",
    monto: p.monto ?? 200_000,
    tipo: p.tipo ?? "gasto",
  };
}

function fijo(p: Partial<FijoHecho> = {}): FijoHecho {
  return { moneda: p.moneda ?? "PYG", monto: p.monto ?? 300_000, tipo: p.tipo ?? "gasto" };
}

function salida(p: Partial<MovimientoStockHecho> = {}): MovimientoStockHecho {
  return {
    fecha: p.fecha ?? "2026-09-10",
    tipo: p.tipo ?? "salida",
    cantidad: p.cantidad ?? 1,
    costo_unitario: p.costo_unitario ?? 400_000,
    valor_resultante: p.valor_resultante ?? 0,
    producto_id: p.producto_id ?? "p1",
    moneda: p.moneda ?? "PYG",
  };
}

function uno(h: Hechos, periodo = PERIODO) {
  const r = estadoDeResultados(h, periodo);
  assert.equal(r.length, 1, "se esperaba una sola moneda");
  return r[0];
}

// ---------------------------------------------------------------------------
// El IVA: el bug que ya costó caro
// ---------------------------------------------------------------------------

test("las ventas van netas de IVA, no por el total facturado", () => {
  const r = uno({ ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })] });
  assert.equal(r.ventas_netas, 1_000_000);
  assert.notEqual(r.ventas_netas, 1_100_000, "se contó el IVA como ingreso del negocio");
});

test("cada línea se netea con SU tasa, no con una sola para todo el documento", () => {
  const r = uno({
    ventas: [
      venta({
        items: [
          item({ total: 1_100_000, iva: 10 }), // 1.000.000 neto
          item({ total: 1_050_000, iva: 5 }), // 1.000.000 neto
          item({ total: 500_000, iva: 0 }), // exento: 500.000 neto
        ],
      }),
    ],
  });
  assert.equal(r.ventas_netas, 2_500_000);
  assert.notEqual(r.ventas_netas, 2_363_636, "se aplicó el 10% a todo el documento");
});

test("una venta sin detalle no se netea de oficio: queda fuera y se avisa", () => {
  const r = uno({
    ventas: [venta({ id: "a", items: [item({ total: 1_100_000 })] }), venta({ id: "b", items: [] })],
  });
  assert.equal(r.ventas_netas, 1_000_000);
  assert.ok(r.faltantes.some((f) => f.includes("no tiene detalle")));
  assert.ok(r.confianza < 1);
});

// ---------------------------------------------------------------------------
// Qué es venta y qué no
// ---------------------------------------------------------------------------

test("las anuladas y los borradores no son ventas", () => {
  for (const estado of ["anulada", "borrador"] as const) {
    const r = estadoDeResultados({ ventas: [venta({ estado })] }, PERIODO);
    assert.equal(r[0]?.ventas_netas ?? 0, 0, `una venta ${estado} no es plata`);
  }
});

test("una venta ya cobrada sigue siendo venta del período", () => {
  const r = uno({ ventas: [venta({ estado: "cobrada" })] });
  assert.equal(r.ventas_netas, 1_000_000);
});

test("una venta de otro mes no entra en este resultado", () => {
  const r = estadoDeResultados({ ventas: [venta({ fecha: "2026-08-10" })] }, PERIODO);
  assert.equal(r.length, 0);
});

// ---------------------------------------------------------------------------
// Costo y resultado
// ---------------------------------------------------------------------------

test("el resultado bruto es la venta neta menos el costo de lo vendido", () => {
  const r = uno({
    ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })],
    movimientos_stock: [salida({ cantidad: 1, costo_unitario: 400_000 })],
  });
  assert.equal(r.costo_vendido, 400_000);
  assert.equal(r.resultado_bruto, 600_000);
});

test("sin kardex el resultado es null, no cero", () => {
  const r = uno({ ventas: [venta()] });
  assert.equal(r.costo_vendido, null);
  assert.equal(r.resultado_bruto, null, "cero diría que no ganó nada, y lo que pasa es que no se sabe");
  assert.equal(r.resultado_operativo, null);
  assert.ok(r.faltantes.some((f) => f.includes("costo de lo vendido")));
  assert.ok(r.confianza <= 0.5);
});

test("el resultado operativo descuenta gastos anotados y fijos", () => {
  const r = uno({
    ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })],
    movimientos_stock: [salida({ costo_unitario: 400_000 })],
    movimientos: [gasto({ monto: 200_000 })],
    fijos: [fijo({ monto: 300_000 })],
  });
  assert.equal(r.gastos_operativos, 500_000);
  assert.equal(r.resultado_operativo, 100_000);
});

test("un ingreso anotado no se resta como gasto", () => {
  const r = uno({
    ventas: [venta()],
    movimientos: [gasto({ monto: 900_000, tipo: "ingreso" }), gasto({ monto: 100_000 })],
  });
  assert.equal(r.gastos_operativos, 100_000);
});

test("un ingreso fijo tampoco se resta", () => {
  const r = uno({ ventas: [venta()], fijos: [fijo({ monto: 900_000, tipo: "ingreso" })] });
  assert.equal(r.gastos_operativos, 0);
});

test("un gasto de otro mes no entra", () => {
  const r = uno({ ventas: [venta()], movimientos: [gasto({ fecha: "2026-08-15" })] });
  assert.equal(r.gastos_operativos, 0);
});

// ---------------------------------------------------------------------------
// Lo que no se puede, dicho
// ---------------------------------------------------------------------------

test("siempre avisa que esto no sirve para la SET", () => {
  const r = uno({ ventas: [venta()] });
  assert.ok(r.advertencias.includes(NO_ES_PARA_LA_SET));
});

test("siempre dice dónde se corta y por qué", () => {
  const r = uno({ ventas: [venta()], movimientos_stock: [salida()] });
  assert.ok(
    r.faltantes.some((f) => f.includes("intereses") && f.includes("depreciación") && f.includes("impuestos")),
  );
});

test("no existe ninguna línea de EBITDA, utilidad neta ni impuestos", () => {
  const r = uno({ ventas: [venta()], movimientos_stock: [salida()] });
  const conceptos = r.lineas.map((l) => l.concepto.toLowerCase()).join(" ");
  // "ventas netas" sí es una línea válida; lo que no puede existir es una
  // utilidad neta, que exige la línea de impuestos.
  for (const prohibido of ["ebitda", "utilidad neta", "resultado neto", "impuesto", "deprecia", "interes"]) {
    assert.ok(!conceptos.includes(prohibido), `apareció una línea de "${prohibido}" que no se puede calcular`);
  }
});

test("avisa que los fijos se contaron una sola vez", () => {
  const r = uno({ ventas: [venta()], fijos: [fijo()] });
  assert.ok(r.advertencias.some((a) => a.includes("una sola vez")));
});

test("sin fijos no arrastra esa advertencia", () => {
  const r = uno({ ventas: [venta()] });
  assert.ok(!r.advertencias.some((a) => a.includes("una sola vez")));
});

// ---------------------------------------------------------------------------
// Monedas
// ---------------------------------------------------------------------------

test("cada moneda tiene su propio resultado y nunca se suman", () => {
  const r = estadoDeResultados(
    {
      ventas: [
        venta({ id: "a", moneda: "PYG", items: [item({ total: 1_100_000, iva: 10 })] }),
        venta({ id: "b", moneda: "USD", items: [item({ total: 110, iva: 10 })] }),
      ],
    },
    PERIODO,
  );

  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x.moneda === "PYG")?.ventas_netas, 1_000_000);
  assert.equal(r.find((x) => x.moneda === "USD")?.ventas_netas, 100);
});

test("un gasto en dólares no se descuenta del resultado en guaraníes", () => {
  const r = estadoDeResultados(
    {
      ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })],
      movimientos_stock: [salida({ costo_unitario: 100_000 })],
      movimientos: [gasto({ moneda: "USD", monto: 500 })],
    },
    PERIODO,
  );
  assert.equal(r.find((x) => x.moneda === "PYG")?.gastos_operativos, 0);
});

// ---------------------------------------------------------------------------
// Margen
// ---------------------------------------------------------------------------

test("el margen operativo se divide sobre la venta neta, no sobre el total facturado", () => {
  const r = uno({
    ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })],
    movimientos_stock: [salida({ costo_unitario: 500_000 })],
  });
  // 1.000.000 neto − 500.000 costo = 500.000 → 50%
  assert.equal(margenOperativo(r), 50);
  assert.notEqual(margenOperativo(r), (500_000 / 1_100_000) * 100, "se dividió sobre el total con IVA");
});

test("sin resultado no hay margen", () => {
  const r = uno({ ventas: [venta()] });
  assert.equal(margenOperativo(r), null);
});

test("sin ventas no se divide por cero", () => {
  const r = uno({ ventas: [venta({ items: [] })], movimientos_stock: [salida()] });
  assert.equal(margenOperativo(r), null);
});
