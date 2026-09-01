import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularIndicadores,
  loQueFalta,
  periodoAnterior,
  type GastoIndicador,
  type VentaIndicador,
} from "./indicadores.ts";

const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };

function venta(
  p: { fecha?: string; moneda?: string | null; total?: number; iva?: 0 | 5 | 10; costo?: number | null; contacto_id?: string | null; contacto_nombre?: string | null } = {},
): VentaIndicador {
  const total = p.total ?? 110_000;
  const iva = p.iva ?? 10;
  const costo = p.costo === undefined ? 66_000 : p.costo;

  return {
    fecha: p.fecha ?? "2026-08-10",
    moneda: p.moneda ?? "PYG",
    contacto_id: p.contacto_id ?? null,
    contacto_nombre: p.contacto_nombre ?? null,
    items: [{ total, iva, cantidad: 1, costo_unitario: costo }],
  };
}

function mov(p: Partial<GastoIndicador> = {}): GastoIndicador {
  return { fecha: "2026-08-10", moneda: "PYG", monto: 100_000, ...p };
}

function uno(datos: Parameters<typeof calcularIndicadores>[0]) {
  const r = calcularIndicadores(datos);
  assert.equal(r.length, 1, "esperaba una sola moneda");
  return r[0];
}

// ============================================================
// Todo neto de IVA
// ============================================================
//
// Es la diferencia entre "vendiste 10 millones" y "te quedaron 9,09 antes de
// pagar nada". Si esto estuviera mal, TODOS los indicadores estarían inflados
// el mismo 9% y ninguno lo delataría.

test("el ticket promedio es neto, no bruto", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta({ total: 110_000 }), venta({ total: 220_000 })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  // 110.000 → 100.000 neto; 220.000 → 200.000. Promedio 150.000, no 165.000.
  assert.equal(i.ticket_promedio, 150_000);
  assert.notEqual(i.ticket_promedio, 165_000);
});

test("la ganancia también sale de los dos netos", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta({ total: 110_000, costo: 66_000 })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  // 100.000 neto vendido − 60.000 neto comprado.
  assert.equal(i.ganancia, 40_000);
  assert.equal(Math.round(i.margen as number), 40);
});

test("el ROI dice cuánto volvió por cada guaraní puesto", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta({ total: 110_000, costo: 66_000 })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  // 40.000 de ganancia sobre 60.000 de costo = 66,7%.
  assert.equal(Math.round(i.roi as number), 67);
});

// ============================================================
// Lo que no se sabe, no se inventa
// ============================================================

test("sin ninguna venta con costo, la ganancia es null y no cero", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta({ costo: null })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(i.ganancia, null);
  assert.equal(i.margen, null);
  assert.equal(i.roi, null);
  assert.equal(i.ventas_sin_costo, 1);
});

test("las ventas sin costo no se cuentan con costo cero: inflarían la ganancia", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [
      venta({ total: 110_000, costo: 66_000 }),
      venta({ total: 110_000, costo: null }),
    ],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  // Solo la que tiene costo entra en la cuenta: 40.000, no 140.000.
  assert.equal(i.ganancia, 40_000);
  assert.equal(i.ventas_sin_costo, 1);
  // Pero el ticket promedio sí las cuenta a las dos: eso sí se sabe.
  assert.equal(i.ventas.cantidad, 2);
});

test("sin ventas en el período anterior no se dice que creció infinito", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta()],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(i.crecimiento_ventas, null);
});

test("sin gastos fijos declarados no hay punto de equilibrio inventado", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta()],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(i.punto_equilibrio, null);
});

// ============================================================
// Crecimiento contra el período anterior
// ============================================================

test("el período anterior es del mismo largo y termina justo antes", () => {
  assert.deepEqual(periodoAnterior({ desde: "2026-08-01", hasta: "2026-08-31" }), {
    desde: "2026-07-01",
    hasta: "2026-07-31",
  });
});

test("crecer al doble se informa como 100%", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [
      venta({ fecha: "2026-08-10", total: 220_000 }),
      venta({ fecha: "2026-07-10", total: 110_000 }),
    ],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(Math.round(i.crecimiento_ventas as number), 100);
});

test("caer a la mitad se informa como -50%", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [
      venta({ fecha: "2026-08-10", total: 110_000 }),
      venta({ fecha: "2026-07-10", total: 220_000 }),
    ],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(Math.round(i.crecimiento_ventas as number), -50);
});

// ============================================================
// Punto de equilibrio
// ============================================================

test("dice cuánto hay que vender para cubrir los fijos", () => {
  const i = uno({
    periodo: AGOSTO,
    // 40% de margen.
    ventas: [venta({ total: 110_000, costo: 66_000 })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [mov({ monto: 2_000_000 })],
  });

  // 2.000.000 de fijos con 40% de margen: hay que vender 5.000.000.
  assert.equal(i.punto_equilibrio, 5_000_000);
});

test("con margen negativo no hay punto de equilibrio: vender más empeora", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta({ total: 110_000, costo: 200_000 })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [mov({ monto: 2_000_000 })],
  });

  assert.ok((i.margen as number) < 0);
  assert.equal(i.punto_equilibrio, null);
});

// ============================================================
// Concentración de clientes
// ============================================================

test("avisa cuánto pesa el cliente más grande", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [
      venta({ contacto_id: "a", contacto_nombre: "Caro", total: 330_000 }),
      venta({ contacto_id: "b", contacto_nombre: "Rossana", total: 110_000 }),
    ],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(i.concentracion?.nombre, "Caro");
  assert.equal(Math.round(i.concentracion?.porcentaje ?? 0), 75);
});

test("las ventas sin cliente se agrupan como consumidor final", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta({ contacto_id: null }), venta({ contacto_id: null })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(i.concentracion?.nombre, "Consumidor final");
  assert.equal(Math.round(i.concentracion?.porcentaje ?? 0), 100);
});

// ============================================================
// El balance y las monedas
// ============================================================

test("el balance es lo que entró menos lo que salió", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [],
    ingresos: [mov({ monto: 5_000_000 })],
    gastos: [mov({ monto: 1_200_000 })],
    fijosMensuales: [],
  });

  assert.equal(i.balance, 3_800_000);
});

test("cada moneda tiene su propio juego de indicadores", () => {
  const r = calcularIndicadores({
    periodo: AGOSTO,
    ventas: [
      venta({ moneda: "PYG", total: 110_000 }),
      venta({ moneda: "USD", total: 110, costo: 66 }),
    ],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(r.length, 2);

  const pyg = r.find((x) => x.moneda === "PYG");
  const usd = r.find((x) => x.moneda === "USD");

  assert.equal(pyg?.ticket_promedio, 100_000);
  assert.equal(usd?.ticket_promedio, 100);
  // El número que no puede existir.
  assert.ok(!r.some((x) => x.ventas.neto === 100_100));
});

test("lo de afuera del período no entra", () => {
  const i = uno({
    periodo: AGOSTO,
    ventas: [venta({ fecha: "2026-09-05" }), venta({ fecha: "2026-08-15" })],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  assert.equal(i.ventas.cantidad, 1);
});

// ============================================================
// Y lo que EOS todavía no puede calcular, dicho
// ============================================================

test("se declara lo que falta y qué haría falta para tenerlo", () => {
  const falta = loQueFalta();

  assert.ok(falta.length >= 4);
  for (const f of falta) {
    assert.ok(f.indicador.length > 0);
    assert.ok(f.necesita.length > 20, `${f.indicador} no explica qué necesita`);
  }

  const nombres = falta.map((f) => f.indicador).join(" ");
  assert.match(nombres, /ROE/);
  assert.match(nombres, /EBITDA/);
});

test("una venta que mezcla tasas se netea línea por línea", () => {
  // Es el motivo por el que el desglose va por ítem: sacarle el IVA al total
  // con una sola tasa daría un neto equivocado en toda venta mixta.
  const i = uno({
    periodo: AGOSTO,
    ventas: [
      {
        fecha: "2026-08-10",
        moneda: "PYG",
        contacto_id: null,
        contacto_nombre: null,
        items: [
          { total: 110_000, iva: 10, cantidad: 1, costo_unitario: null },
          { total: 100_000, iva: 0, cantidad: 1, costo_unitario: null },
        ],
      },
    ],
    gastos: [],
    ingresos: [],
    fijosMensuales: [],
  });

  // 100.000 (gravado neteado) + 100.000 (exento, sin IVA que sacar).
  assert.equal(i.ventas.neto, 200_000);

  // Con una sola tasa del 10% sobre el total de 210.000 habría dado 190.909.
  assert.notEqual(i.ventas.neto, 190_909);
});
