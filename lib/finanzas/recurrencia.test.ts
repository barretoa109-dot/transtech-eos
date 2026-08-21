import test from "node:test";
import assert from "node:assert/strict";

import {
  detectarSeries,
  normalizarDescripcion,
  proyectar,
  proximoIngreso,
  type MovimientoBase,
} from "./recurrencia.ts";

/**
 * Tests de la detección de recurrencia.
 *
 * Este módulo decide cuánta plata cree el usuario que tiene. Cada caso de acá
 * corresponde a una falla real: o un error que se encontró probando contra
 * datos de verdad, o una trampa que el código evita a propósito y que sería
 * fácil de romper sin darse cuenta.
 */

const g = (descripcion: string, monto: number, fecha: string): MovimientoBase => ({
  tipo: "gasto",
  monto,
  fecha,
  descripcion,
});

const i = (descripcion: string, monto: number, fecha: string): MovimientoBase => ({
  tipo: "ingreso",
  monto,
  fecha,
  descripcion,
});

test("agrupa el mismo concepto aunque cambie el mes y los acentos", () => {
  assert.equal(normalizarDescripcion("Pago ALQUÍLER agosto 2026"), "pago alquiler");
  assert.equal(normalizarDescripcion("pago alquiler - Septiembre/2026"), "pago alquiler");
});

test("detecta una serie mensual por día del mes", () => {
  const series = detectarSeries([
    g("Pago alquiler mayo", 2_500_000, "2026-05-05"),
    g("Pago alquiler junio", 2_500_000, "2026-06-05"),
    g("Pago alquiler julio", 2_600_000, "2026-07-05"),
  ]);

  assert.equal(series.length, 1);
  assert.equal(series[0].periodicidad, "mensual");
  assert.equal(series[0].ocurrencias, 3);
  assert.equal(series[0].proxima_fecha, "2026-08-05");
});

test("reconoce cadencias semanal y quincenal", () => {
  const semanal = detectarSeries([
    g("Combustible", 300_000, "2026-08-03"),
    g("Combustible", 310_000, "2026-08-10"),
    g("Combustible", 295_000, "2026-08-17"),
  ]);
  assert.equal(semanal[0]?.periodicidad, "semanal");

  const quincenal = detectarSeries([
    g("Cuota moto", 800_000, "2026-07-15"),
    g("Cuota moto", 800_000, "2026-07-30"),
    g("Cuota moto", 800_000, "2026-08-14"),
  ]);
  assert.equal(quincenal[0]?.periodicidad, "quincenal");
});

test("respeta el fin de mes: el 31 no cae el 3 de marzo", () => {
  const series = detectarSeries([
    g("Cuota colegio", 1_200_000, "2026-01-31"),
    g("Cuota colegio", 1_200_000, "2026-02-28"),
    g("Cuota colegio", 1_200_000, "2026-03-31"),
  ]);

  assert.equal(series[0].periodicidad, "mensual");
  assert.equal(series[0].proxima_fecha, "2026-04-30");
});

test("una sola aparición no es una serie", () => {
  assert.equal(detectarSeries([g("Notebook usada", 940_000, "2026-07-19")]).length, 0);
});

test("importes dispares no forman serie aunque compartan nombre", () => {
  const series = detectarSeries([
    g("Supermercado", 50_000, "2026-06-01"),
    g("Supermercado", 900_000, "2026-07-01"),
  ]);
  assert.equal(series.length, 0);
});

test("sin descripción utilizable no se agrupa nada", () => {
  const series = detectarSeries([
    { tipo: "gasto", monto: 120_000, fecha: "2026-06-02", descripcion: null },
    { tipo: "gasto", monto: 120_000, fecha: "2026-07-02", descripcion: null },
  ]);
  assert.equal(series.length, 0);
});

test("la etiqueta no arrastra el mes del primer movimiento", () => {
  const series = detectarSeries([
    i("Sueldo mayo 2026", 12_000_000, "2026-05-30"),
    i("Sueldo junio 2026", 12_000_000, "2026-06-30"),
    i("Sueldo julio 2026", 12_250_000, "2026-07-30"),
  ]);

  // Si dijera "Sueldo mayo 2026", el ingreso proyectado a agosto se mostraría
  // con el mes equivocado.
  assert.equal(series[0].descripcion, "Sueldo");
});

test("NO proyecta una serie que dejó de ocurrir", () => {
  // El colegio terminó en marzo. Proyectarlo en agosto le restaría al usuario
  // plata que en realidad tiene.
  const series = detectarSeries([
    g("Cuota colegio", 1_200_000, "2026-01-31"),
    g("Cuota colegio", 1_200_000, "2026-02-28"),
    g("Cuota colegio", 1_200_000, "2026-03-31"),
  ]);

  const proyectado = proyectar(series, { desde: "2026-08-20", hasta: "2026-09-30" });
  assert.equal(proyectado.length, 0);
});

test("sí proyecta una serie apenas atrasada", () => {
  const series = detectarSeries([
    g("Pago alquiler", 2_500_000, "2026-06-05"),
    g("Pago alquiler", 2_500_000, "2026-07-05"),
  ]);

  // Próxima sería 2026-08-05, un período antes del horizonte: todavía viva.
  const proyectado = proyectar(series, { desde: "2026-08-20", hasta: "2026-09-30" });
  assert.equal(proyectado.length, 1);
  assert.equal(proyectado[0].fecha, "2026-09-05");
});

test("no proyecta lo que el usuario ya tiene cargado (evita restar dos veces)", () => {
  const series = detectarSeries([
    g("Pago alquiler", 2_500_000, "2026-06-05"),
    g("Pago alquiler", 2_500_000, "2026-07-05"),
    g("Pago alquiler", 2_500_000, "2026-08-05"),
  ]);

  const yaRegistrados: MovimientoBase[] = [
    { tipo: "gasto", monto: 2_500_000, fecha: "2026-09-05", descripcion: "Pago alquiler septiembre" },
  ];

  const conDedup = proyectar(series, { desde: "2026-08-20", hasta: "2026-09-30", yaRegistrados });
  const sinDedup = proyectar(series, { desde: "2026-08-20", hasta: "2026-09-30" });

  assert.equal(sinDedup.length, 1, "sin dedup debería proyectar septiembre");
  assert.equal(conDedup.length, 0, "con dedup no debe duplicar el gasto");
});

test("el próximo ingreso estimado sale de la serie de ingresos", () => {
  const series = detectarSeries([
    i("Sueldo", 12_000_000, "2026-06-30"),
    i("Sueldo", 12_000_000, "2026-07-30"),
    g("Pago alquiler", 2_500_000, "2026-07-05"),
    g("Pago alquiler", 2_500_000, "2026-08-05"),
  ]);

  const ingreso = proximoIngreso(series, "2026-08-20");
  assert.ok(ingreso, "debería detectar un próximo ingreso");
  assert.equal(ingreso.tipo, "ingreso");
  assert.equal(ingreso.fecha, "2026-08-30");
  assert.equal(ingreso.monto, 12_000_000);
});

test("sin ingresos recurrentes no inventa un próximo ingreso", () => {
  const series = detectarSeries([
    g("Pago alquiler", 2_500_000, "2026-07-05"),
    g("Pago alquiler", 2_500_000, "2026-08-05"),
  ]);

  assert.equal(proximoIngreso(series, "2026-08-20"), null);
});
