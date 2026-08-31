import assert from "node:assert/strict";
import test from "node:test";

import { calcularVenta, ivaIncluido, tasaValida, type LineaVenta } from "./impuestos.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { armarInforme, type MovimientoInforme } from "../informes/armar.ts";

/**
 * Los bordes del dinero: montos grandes, redondeo y reproducibilidad.
 *
 * ============================================================
 * POR QUÉ HACE FALTA APARTE DE `impuestos.test.ts`
 * ============================================================
 *
 * Aquellos prueban que la cuenta del IVA sea la correcta con números normales.
 * Esto prueba otra cosa: que la cuenta SIGA siendo correcta cuando los números
 * dejan de ser normales.
 *
 * Es la mitad del punto 27 que nadie escribe hasta que un usuario la encuentra:
 * la venta de una camioneta en guaraníes tiene nueve dígitos, una lista de
 * doscientos ítems acumula doscientos redondeos, y un total que no cierra
 * contra la suma de sus líneas es una factura que la SET no acepta.
 *
 * ============================================================
 * LA INVARIANTE QUE NO SE PUEDE ROMPER NUNCA
 * ============================================================
 *
 *     subtotal + iva_total === total
 *
 * Si esa igualdad falla aunque sea por un guaraní, el comprobante impreso se
 * contradice a sí mismo. Y falla justamente donde nadie mira: al sumar muchas
 * líneas redondeadas por separado.
 */

function linea(parcial: Partial<LineaVenta> = {}): LineaVenta {
  return { descripcion: "Item", cantidad: 1, precio_unitario: 100_000, iva: 10, ...parcial };
}

// ============================================================
// La invariante, en todos los tamaños
// ============================================================

test("subtotal + IVA da exactamente el total, con una línea o con doscientas", () => {
  const tamanios = [1, 2, 7, 33, 200];

  for (const n of tamanios) {
    const lineas = Array.from({ length: n }, (_, i) =>
      linea({
        cantidad: (i % 7) + 1,
        // Precios que no son redondos a propósito: los redondos no rompen nada.
        precio_unitario: 13_333 + i * 977,
        iva: ([10, 5, 0] as const)[i % 3],
      }),
    );

    const t = calcularVenta(lineas);

    assert.equal(
      t.subtotal + t.iva_total,
      t.total,
      `con ${n} líneas: ${t.subtotal} + ${t.iva_total} ≠ ${t.total}`,
    );
  }
});

test("y el total es la suma de las líneas, no una cuenta aparte", () => {
  const lineas = Array.from({ length: 50 }, (_, i) =>
    linea({ cantidad: (i % 4) + 1, precio_unitario: 7_777 + i, iva: ([10, 5, 0] as const)[i % 3] }),
  );

  const t = calcularVenta(lineas);

  assert.equal(
    t.total,
    t.lineas.reduce((suma, l) => suma + l.total, 0),
  );
});

test("cada tramo de IVA cierra contra sus propias líneas", () => {
  const lineas = [
    linea({ precio_unitario: 111_111, iva: 10 }),
    linea({ precio_unitario: 222_222, iva: 5 }),
    linea({ precio_unitario: 333_333, iva: 0 }),
    linea({ precio_unitario: 444_444, iva: 10 }),
  ];

  const t = calcularVenta(lineas);

  for (const tramo of t.por_tasa) {
    assert.equal(
      tramo.gravado + tramo.iva,
      tramo.total,
      `el tramo del ${tramo.tasa}% no cierra`,
    );
  }

  assert.equal(
    t.por_tasa.reduce((s, x) => s + x.total, 0),
    t.total,
  );
});

// ============================================================
// Montos grandes
// ============================================================
//
// La columna de la base es `numeric(16,2)`: catorce dígitos enteros. Un número
// de JavaScript es exacto hasta 2^53, o sea nueve mil billones. El techo real
// lo pone la base, y hasta ahí la cuenta tiene que seguir siendo exacta.

test("una venta de nueve dígitos no pierde un guaraní", () => {
  // Una camioneta. Es un monto perfectamente normal en Paraguay.
  const t = calcularVenta([linea({ precio_unitario: 385_000_000, iva: 10 })]);

  assert.equal(t.total, 385_000_000);
  assert.equal(t.iva_total, Math.round(385_000_000 / 11));
  assert.equal(t.subtotal + t.iva_total, t.total);
});

test("y una de doce dígitos tampoco", () => {
  const monto = 999_999_999_999;
  const t = calcularVenta([linea({ precio_unitario: monto, iva: 10 })]);

  assert.equal(t.total, monto);
  assert.equal(t.subtotal + t.iva_total, t.total);
  assert.ok(Number.isSafeInteger(t.total), "el total dejó de ser un entero exacto");
});

test("doscientas líneas grandes siguen sumando exacto", () => {
  const lineas = Array.from({ length: 200 }, () =>
    linea({ cantidad: 9, precio_unitario: 99_999_999, iva: 10 }),
  );

  const t = calcularVenta(lineas);

  assert.ok(Number.isSafeInteger(t.total));
  assert.equal(t.subtotal + t.iva_total, t.total);
});

// ============================================================
// Guaraníes sin decimales
// ============================================================

test("el guaraní nunca sale con decimales, aunque la cuenta los tenga", () => {
  // 1/3 de un guaraní no existe.
  const t = calcularVenta([linea({ cantidad: 1, precio_unitario: 1_000, iva: 10 })]);

  assert.ok(Number.isInteger(t.total), "el total trajo decimales");
  assert.ok(Number.isInteger(t.iva_total), "el IVA trajo decimales");
  assert.ok(Number.isInteger(t.subtotal), "el subtotal trajo decimales");
  assert.ok(!formatearMonto(t.total, "PYG").includes(","), "el guaraní se escribió con decimales");
});

test("el dólar SÍ los lleva: redondearlo lo desalinea del extracto", () => {
  assert.ok(formatearMonto(1250.5, "USD").includes(","));
  assert.equal(formatearMonto(1250.5, "USD"), "US$ 1.250,50");
});

test("una cantidad fraccionada —tres kilos y medio— no rompe el redondeo", () => {
  const t = calcularVenta([linea({ cantidad: 3.5, precio_unitario: 9_999, iva: 10 })]);

  assert.equal(t.total, Math.round(3.5 * 9_999));
  assert.ok(Number.isInteger(t.total));
  assert.equal(t.subtotal + t.iva_total, t.total);
});

// ============================================================
// Los ceros y lo que no debería pasar
// ============================================================

test("una línea en cero no aporta ni rompe", () => {
  const t = calcularVenta([linea({ precio_unitario: 0 }), linea({ precio_unitario: 50_000 })]);

  assert.equal(t.total, 50_000);
  assert.equal(t.subtotal + t.iva_total, t.total);
});

test("el exento no genera IVA, y su total va a su propia casilla", () => {
  const t = calcularVenta([linea({ precio_unitario: 80_000, iva: 0 })]);

  assert.equal(t.iva_total, 0);
  assert.equal(t.exentas, 80_000);
  assert.equal(t.subtotal, 80_000);
});

test("una tasa que falta se cobra al 10%, no exenta", () => {
  // Ya está cubierto en impuestos.test.ts; se repite acá porque es el error de
  // redondeo más caro que existe: una venta gravada facturada como exenta.
  assert.equal(tasaValida(null), 10);
  assert.equal(tasaValida(""), 10);
  assert.equal(tasaValida(undefined), 10);
  assert.equal(tasaValida(0), 0);
});

test("el IVA de un monto minúsculo no se va a cero por redondeo hacia abajo", () => {
  // 11 guaraníes al 10% son exactamente 1.
  assert.equal(ivaIncluido(11, 10), 1);
  // 5 guaraníes al 10% redondean a 0, y está bien: no existe medio guaraní.
  assert.equal(ivaIncluido(5, 10), 0);
});

// ============================================================
// Punto 28: el mismo informe, dos veces, tiene que dar lo mismo
// ============================================================
//
// Un informe que cambia entre dos corridas idénticas es un informe que nadie
// puede auditar — y el usuario lo va a descubrir comparando el balance de hoy
// con el que bajó ayer del mismo período.

const PERIODO = { desde: "2026-08-01", hasta: "2026-08-31", etiqueta: "agosto" };

function movimientos(): MovimientoInforme[] {
  return [
    { tipo: "ingreso", monto: 5_000_000, moneda: "PYG", fecha: "2026-08-05", descripcion: "Sueldo", categoria: "sueldo" },
    { tipo: "gasto", monto: 1_200_000, moneda: "PYG", fecha: "2026-08-07", descripcion: "Alquiler", categoria: "vivienda" },
    { tipo: "gasto", monto: 333_333, moneda: "PYG", fecha: "2026-08-12", descripcion: "Súper", categoria: "comida" },
    { tipo: "compromiso", monto: 450_000, moneda: "PYG", fecha: "2026-08-20", descripcion: "Colegio", categoria: "educacion" },
    // Fuera del período: no tiene que entrar en ninguna corrida.
    { tipo: "gasto", monto: 999_999, moneda: "PYG", fecha: "2026-07-30", descripcion: "Mes pasado", categoria: "otros" },
  ] as MovimientoInforme[];
}

test("dos corridas iguales dan exactamente el mismo informe", () => {
  const args = { periodo: PERIODO, moneda: "PYG", hoy: "2026-09-01", movimientos: movimientos() };

  assert.deepEqual(armarInforme(args), armarInforme(args));
});

test("y el orden en que vienen los movimientos no cambia los totales", () => {
  const base = { periodo: PERIODO, moneda: "PYG", hoy: "2026-09-01" };

  const derecho = armarInforme({ ...base, movimientos: movimientos() });
  const alReves = armarInforme({ ...base, movimientos: [...movimientos()].reverse() });

  assert.equal(derecho.resumen.ingresos, alReves.resumen.ingresos);
  assert.equal(derecho.resumen.gastos, alReves.resumen.gastos);
  assert.equal(derecho.resumen.neto, alReves.resumen.neto);
});

test("lo de afuera del período se queda afuera, corra cuando corra", () => {
  const informe = armarInforme({
    periodo: PERIODO,
    moneda: "PYG",
    hoy: "2026-09-01",
    movimientos: movimientos(),
  });

  assert.equal(informe.resumen.gastos, 1_200_000 + 333_333);
  assert.ok(!JSON.stringify(informe).includes("Mes pasado"));
});

test("el informe de un período cerrado no depende de cuándo se lo pida", () => {
  // El mismo agosto, pedido en septiembre y pedido en diciembre.
  const enSeptiembre = armarInforme({
    periodo: PERIODO,
    moneda: "PYG",
    hoy: "2026-09-01",
    movimientos: movimientos(),
  });

  const enDiciembre = armarInforme({
    periodo: PERIODO,
    moneda: "PYG",
    hoy: "2026-12-15",
    movimientos: movimientos(),
  });

  assert.equal(enSeptiembre.resumen.ingresos, enDiciembre.resumen.ingresos);
  assert.equal(enSeptiembre.resumen.gastos, enDiciembre.resumen.gastos);
  assert.equal(enSeptiembre.resumen.neto, enDiciembre.resumen.neto);
});
