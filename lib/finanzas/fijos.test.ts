import test from "node:test";
import assert from "node:assert/strict";

import { combinarSeries, confirmadosPorLaRealidad, proximaFechaDelMes, type Fijo } from "./fijos.ts";
import { detectarSeries, type MovimientoBase } from "./recurrencia.ts";

/**
 * Tests de los fijos declarados.
 *
 * El caso crítico es el de la duplicación: si lo declarado y lo detectado se
 * sumaran, el usuario vería su alquiler descontado dos veces y el disponible
 * real quedaría mucho más bajo de lo que corresponde.
 */

const alquiler: Fijo = { tipo: "gasto", descripcion: "Alquiler", monto: 2_500_000, dia_del_mes: 5 };
const sueldo: Fijo = { tipo: "ingreso", descripcion: "Sueldo", monto: 12_000_000, dia_del_mes: 30 };

test("la próxima fecha respeta si el día ya pasó este mes", () => {
  assert.equal(proximaFechaDelMes(5, "2026-08-01"), "2026-08-05", "todavía no pasó");
  assert.equal(proximaFechaDelMes(5, "2026-08-05"), "2026-08-05", "es hoy, cuenta hoy");
  assert.equal(proximaFechaDelMes(5, "2026-08-20"), "2026-09-05", "ya pasó, va al mes que viene");
});

test("el día 31 se ancla al último día en los meses cortos", () => {
  assert.equal(proximaFechaDelMes(31, "2026-02-10"), "2026-02-28");
  assert.equal(proximaFechaDelMes(31, "2026-04-10"), "2026-04-30");
  assert.equal(proximaFechaDelMes(31, "2026-01-10"), "2026-01-31");
});

test("cruza bien el fin de año", () => {
  assert.equal(proximaFechaDelMes(5, "2026-12-20"), "2027-01-05");
});

test("un fijo declarado se proyecta desde el primer día, sin historial", () => {
  const series = combinarSeries([], [alquiler, sueldo], "2026-08-22");

  assert.equal(series.length, 2);

  const declaradoAlquiler = series.find((s) => s.descripcion === "Alquiler");
  assert.ok(declaradoAlquiler);
  assert.equal(declaradoAlquiler.monto, 2_500_000);
  assert.equal(declaradoAlquiler.periodicidad, "mensual");
  assert.equal(declaradoAlquiler.proxima_fecha, "2026-09-05");
  assert.equal(declaradoAlquiler.ocurrencias, 0, "no se inventa historial");
  assert.ok(
    declaradoAlquiler.confianza >= 0.6,
    "tiene que superar el umbral de proyección para servir desde el día uno",
  );
});

test("LA REALIDAD LE GANA A LO DECLARADO: no se duplica el gasto", () => {
  // El correo ya trajo el alquiler dos veces: hay serie detectada.
  const movimientos: MovimientoBase[] = [
    { tipo: "gasto", monto: 2_600_000, fecha: "2026-07-05", descripcion: "Pago alquiler julio" },
    { tipo: "gasto", monto: 2_600_000, fecha: "2026-08-05", descripcion: "Pago alquiler agosto" },
  ];
  const detectadas = detectarSeries(movimientos);
  assert.equal(detectadas.length, 1, "precondición: el detector encontró el alquiler");

  // El usuario había declarado el alquiler con la misma descripción normalizada.
  const declarado: Fijo = { ...alquiler, descripcion: "Pago alquiler" };
  const combinadas = combinarSeries(detectadas, [declarado], "2026-08-22");

  assert.equal(
    combinadas.length,
    1,
    "si se sumaran, el alquiler se descontaría dos veces del disponible real",
  );
  assert.equal(combinadas[0].monto, 2_600_000, "gana el importe real, no el declarado");
  assert.equal(combinadas[0].ocurrencias, 2, "gana la serie observada");
});

test("un fijo que todavía no apareció en la realidad se mantiene", () => {
  const movimientos: MovimientoBase[] = [
    { tipo: "gasto", monto: 2_600_000, fecha: "2026-07-05", descripcion: "Pago alquiler julio" },
    { tipo: "gasto", monto: 2_600_000, fecha: "2026-08-05", descripcion: "Pago alquiler agosto" },
  ];
  const detectadas = detectarSeries(movimientos);

  const declarados: Fijo[] = [
    { ...alquiler, descripcion: "Pago alquiler" }, // ya observado
    { tipo: "gasto", descripcion: "Colegio", monto: 1_200_000, dia_del_mes: 10 }, // nunca visto
  ];

  const combinadas = combinarSeries(detectadas, declarados, "2026-08-22");

  assert.equal(combinadas.length, 2);
  assert.ok(combinadas.some((s) => s.descripcion === "Colegio"), "el colegio sigue proyectándose");
});

test("ignora declaraciones sin monto válido", () => {
  const series = combinarSeries(
    [],
    [
      { tipo: "gasto", descripcion: "Vacío", monto: 0, dia_del_mes: 5 },
      { tipo: "gasto", descripcion: "Negativo", monto: -100, dia_del_mes: 5 },
      { tipo: "gasto", descripcion: "NaN", monto: Number.NaN, dia_del_mes: 5 },
    ],
    "2026-08-22",
  );

  assert.equal(series.length, 0);
});

test("cuenta cuántas declaraciones ya confirmó la realidad", () => {
  const detectadas = detectarSeries([
    { tipo: "gasto", monto: 2_600_000, fecha: "2026-07-05", descripcion: "Pago alquiler julio" },
    { tipo: "gasto", monto: 2_600_000, fecha: "2026-08-05", descripcion: "Pago alquiler agosto" },
  ]);

  const declarados: Fijo[] = [
    { ...alquiler, descripcion: "Pago alquiler" },
    { tipo: "gasto", descripcion: "Colegio", monto: 1_200_000, dia_del_mes: 10 },
  ];

  assert.equal(confirmadosPorLaRealidad(detectadas, declarados), 1);
});

test("distingue un ingreso de un gasto con el mismo nombre", () => {
  const detectadas = detectarSeries([
    { tipo: "ingreso", monto: 500_000, fecha: "2026-07-10", descripcion: "Comisiones" },
    { tipo: "ingreso", monto: 500_000, fecha: "2026-08-10", descripcion: "Comisiones" },
  ]);

  // Un gasto llamado igual NO debe considerarse ya observado.
  const combinadas = combinarSeries(
    detectadas,
    [{ tipo: "gasto", descripcion: "Comisiones", monto: 80_000, dia_del_mes: 15 }],
    "2026-08-22",
  );

  assert.equal(combinadas.length, 2, "ingreso y gasto homónimos son cosas distintas");
});
