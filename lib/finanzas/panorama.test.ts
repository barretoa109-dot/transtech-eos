import assert from "node:assert/strict";
import { test } from "node:test";

import { armarPanorama } from "./panorama.ts";
import { detectarRiesgo } from "./riesgo.ts";
import type { Deuda } from "./deudas.ts";

const HOY = "2026-08-24";
const HASTA = "2026-10-08";

function base() {
  return {
    hoy: HOY,
    hasta: HASTA,
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-08-01",
    reservaMinima: 1_000_000,
    movimientos: [],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  };
}

const PRESTAMO: Deuda = {
  acreedor: "Banco Itaú",
  tipo: "prestamo",
  moneda: "PYG",
  saldo_declarado: 6_000_000,
  saldo_declarado_el: "2026-08-01",
  cuota_monto: 500_000,
  cuota_dia: 5,
  cuotas_totales: 12,
  cuotas_pagadas: 0,
  vence_el: null,
  estado: "al_dia",
  preocupa: false,
};

test("las cuotas de las deudas entran a la línea de tiempo", () => {
  const panorama = armarPanorama({ ...base(), deudas: [PRESTAMO] });

  const fechas = panorama.egresos.map((e) => e.fecha);
  assert.deepEqual(fechas, ["2026-09-05", "2026-10-05"]);
  assert.equal(panorama.egresos[0].monto, 500_000);
});

test("los fijos declarados también entran, aunque nunca se hayan visto", () => {
  const panorama = armarPanorama({
    ...base(),
    fijos: [{ tipo: "gasto", descripcion: "Alquiler", monto: 2_000_000, dia_del_mes: 1 }],
  });

  assert.ok(panorama.egresos.some((e) => e.descripcion === "Alquiler" && e.monto === 2_000_000));
});

test("un ingreso fijo declarado queda del lado de los ingresos", () => {
  const panorama = armarPanorama({
    ...base(),
    fijos: [{ tipo: "ingreso", descripcion: "Sueldo", monto: 4_000_000, dia_del_mes: 30 }],
  });

  assert.equal(panorama.egresos.length, 0);
  assert.ok(panorama.ingresos.some((i) => i.monto === 4_000_000));
});

test("la cuota NO se cuenta dos veces si además está anotada como compromiso", () => {
  // Es el escenario real: el débito llega por correo y además la deuda la
  // proyecta. Contarla dos veces produciría una alerta que no corresponde.
  const panorama = armarPanorama({
    ...base(),
    deudas: [PRESTAMO],
    movimientos: [
      { tipo: "compromiso", monto: 500_000, fecha: "2026-09-05", descripcion: "DEB.AUT.PRESTAMO" },
    ],
  });

  const enSeptiembre = panorama.egresos.filter((e) => e.fecha.startsWith("2026-09"));
  assert.equal(enSeptiembre.length, 1);
});

test("el saldo de partida descuenta lo que ya salió", () => {
  const panorama = armarPanorama({
    ...base(),
    movimientos: [
      { tipo: "gasto", monto: 1_500_000, fecha: "2026-08-10", descripcion: "Compra" },
      { tipo: "ingreso", monto: 200_000, fecha: "2026-08-12", descripcion: "Cobro" },
    ],
  });

  assert.equal(panorama.saldoActual, 5_000_000 - 1_500_000 + 200_000);
});

test("de punta a punta: declara un alquiler que no va a poder pagar y EOS lo ve", () => {
  // El caso que la hoja de ruta pone como ejemplo, armado con datos reales
  // del modelo: saldo bajo, alquiler declarado, sueldo que entra después.
  const panorama = armarPanorama({
    ...base(),
    saldoInicial: 1_500_000,
    reservaMinima: 0,
    fijos: [
      { tipo: "gasto", descripcion: "Alquiler", monto: 2_000_000, dia_del_mes: 28 },
      { tipo: "ingreso", descripcion: "Sueldo", monto: 4_500_000, dia_del_mes: 30 },
    ],
  });

  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: panorama.saldoActual,
    reservaMinima: panorama.reservaMinima,
    egresos: panorama.egresos,
    ingresos: panorama.ingresos,
  });

  assert.equal(riesgo?.fecha, "2026-08-28");
  assert.equal(riesgo?.faltante, 500_000);
  assert.equal(riesgo?.alivio?.dias_tarde, 2);
});

test("de punta a punta: con el sueldo antes del alquiler, no hay aviso", () => {
  const panorama = armarPanorama({
    ...base(),
    saldoInicial: 1_500_000,
    reservaMinima: 0,
    fijos: [
      { tipo: "gasto", descripcion: "Alquiler", monto: 2_000_000, dia_del_mes: 28 },
      { tipo: "ingreso", descripcion: "Sueldo", monto: 4_500_000, dia_del_mes: 26 },
    ],
  });

  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: panorama.saldoActual,
    reservaMinima: panorama.reservaMinima,
    egresos: panorama.egresos,
    ingresos: panorama.ingresos,
  });

  assert.equal(riesgo, null);
});
