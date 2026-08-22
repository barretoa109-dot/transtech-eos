import test from "node:test";
import assert from "node:assert/strict";

import {
  calcularRitmo,
  conciliar,
  convieneConciliar,
  type Conciliacion,
  type Movimiento,
} from "./conciliacion.ts";

/**
 * Tests de la conciliación.
 *
 * Acá se decide cuánta plata cree el usuario que tiene, y además si EOS lo
 * molesta o lo deja en paz. Las dos cosas son el producto.
 */

const gasto = (monto: number, fecha: string): Movimiento => ({ tipo: "gasto", monto, fecha });
const ingreso = (monto: number, fecha: string): Movimiento => ({ tipo: "ingreso", monto, fecha });

test("sin conciliaciones opera con el saldo inicial y no inventa descuentos", () => {
  const r = conciliar({
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-08-01",
    conciliaciones: [],
    movimientos: [gasto(300_000, "2026-08-10")],
    hoy: "2026-08-21",
  });

  assert.equal(r.base, 5_000_000);
  assert.equal(r.desde, "2026-08-01");
  assert.equal(r.gasto_invisible, 0, "sin datos no se descuenta nada inventado");
  assert.equal(r.ritmo_diario, null);
  assert.equal(r.conciliaciones, 0);
});

test("la primera conciliación corrige la base y todavía no descuenta", () => {
  // EOS calculaba 5.000.000 pero el usuario tiene 4.500.000: hay medio millón
  // que se gastó sin que EOS lo viera. Con un solo dato no hay ritmo aún.
  const r = conciliar({
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-08-01",
    conciliaciones: [{ fecha: "2026-08-15", saldo_declarado: 4_500_000 }],
    movimientos: [],
    hoy: "2026-08-21",
  });

  assert.equal(r.base, 4_500_000, "la base pasa a ser lo que el usuario dijo");
  assert.equal(r.desde, "2026-08-15");
  assert.equal(r.gasto_invisible, 0, "sin ritmo no se descuenta: EOS no miente, solo no aprendió");
  assert.equal(r.conciliaciones, 1);
});

test("la segunda conciliación enseña el ritmo del gasto invisible", () => {
  // Del 1 al 11 de agosto: partía de 4.000.000, EOS vio un gasto de 500.000,
  // así que esperaba 3.500.000. El usuario dice que tiene 3.200.000.
  // Faltan 300.000 en 10 días = 30.000 por día.
  const conciliaciones: Conciliacion[] = [
    { fecha: "2026-08-01", saldo_declarado: 4_000_000 },
    { fecha: "2026-08-11", saldo_declarado: 3_200_000 },
  ];
  const movimientos = [gasto(500_000, "2026-08-05")];

  assert.equal(calcularRitmo(conciliaciones, movimientos), 30_000);

  // A 5 días de la última, descuenta 150.000 sin preguntar nada.
  const r = conciliar({
    saldoInicial: 4_000_000,
    saldoInicialFecha: "2026-08-01",
    conciliaciones,
    movimientos,
    hoy: "2026-08-16",
  });

  assert.equal(r.ritmo_diario, 30_000);
  assert.equal(r.gasto_invisible, 150_000);
  assert.equal(r.confianza, "alta");
});

test("cuenta los ingresos al calcular el ritmo, no solo los gastos", () => {
  // Partía de 1.000.000, entró un sueldo de 3.000.000 y EOS vio un gasto de
  // 500.000: esperaba 3.500.000. El usuario tiene 3.300.000 -> faltan 200.000
  // en 10 días = 20.000 por día.
  const ritmo = calcularRitmo(
    [
      { fecha: "2026-08-01", saldo_declarado: 1_000_000 },
      { fecha: "2026-08-11", saldo_declarado: 3_300_000 },
    ],
    [ingreso(3_000_000, "2026-08-03"), gasto(500_000, "2026-08-07")],
  );

  assert.equal(ritmo, 20_000);
});

test("si sobra dinero NO se infla el disponible", () => {
  // El usuario tiene MÁS de lo calculado: falta registrar un ingreso. Eso no
  // es gasto invisible, y sumarlo sería mostrarle plata que quizá no entró.
  const ritmo = calcularRitmo(
    [
      { fecha: "2026-08-01", saldo_declarado: 1_000_000 },
      { fecha: "2026-08-11", saldo_declarado: 2_000_000 },
    ],
    [],
  );

  assert.equal(ritmo, 0, "la brecha negativa se ignora, no se convierte en ingreso");
});

test("una conciliación rara no arrastra la estimación para siempre", () => {
  // Tres tramos: dos normales y uno absurdo (el usuario miró otra cuenta).
  // La mediana lo neutraliza; el promedio lo habría dejado pasar.
  const ritmo = calcularRitmo(
    [
      { fecha: "2026-06-01", saldo_declarado: 5_000_000 },
      { fecha: "2026-06-11", saldo_declarado: 4_800_000 }, // 20.000/día
      { fecha: "2026-06-21", saldo_declarado: 100_000 }, // absurdo
      { fecha: "2026-07-01", saldo_declarado: 0 }, // 10.000/día
    ],
    [],
  );

  assert.ok(ritmo !== null && ritmo <= 470_000, `la mediana debería contener el outlier, dio ${ritmo}`);
});

test("el ritmo tiene un tope absoluto", () => {
  const ritmo = calcularRitmo(
    [
      { fecha: "2026-08-01", saldo_declarado: 900_000_000 },
      { fecha: "2026-08-02", saldo_declarado: 0 },
    ],
    [],
  );

  assert.ok(ritmo !== null && ritmo <= 2_000_000, `debería estar topeado, dio ${ritmo}`);
});

test("la confianza baja cuando el dato queda viejo", () => {
  const conciliaciones: Conciliacion[] = [
    { fecha: "2026-06-01", saldo_declarado: 4_000_000 },
    { fecha: "2026-06-11", saldo_declarado: 3_800_000 },
  ];

  const reciente = conciliar({
    saldoInicial: 0, saldoInicialFecha: "2026-06-01",
    conciliaciones, movimientos: [], hoy: "2026-06-20",
  });
  assert.equal(reciente.confianza, "alta");

  const viejo = conciliar({
    saldoInicial: 0, saldoInicialFecha: "2026-06-01",
    conciliaciones, movimientos: [], hoy: "2026-09-01",
  });
  assert.equal(viejo.confianza, "baja");
});

/* =========================================================
   Lo que define la filosofía: cuánto molesta EOS
========================================================= */

test("pregunta la primera vez, pregunta la segunda, y después deja en paz", () => {
  const sinDatos = conciliar({
    saldoInicial: 5_000_000, saldoInicialFecha: "2026-08-01",
    conciliaciones: [], movimientos: [gasto(1, "2026-08-02")], hoy: "2026-08-21",
  });
  assert.equal(convieneConciliar(sinDatos), true, "sin ninguna conciliación, vale preguntar");

  const unaSola = conciliar({
    saldoInicial: 5_000_000, saldoInicialFecha: "2026-08-01",
    conciliaciones: [{ fecha: "2026-08-01", saldo_declarado: 4_000_000 }],
    movimientos: [], hoy: "2026-08-21",
  });
  assert.equal(convieneConciliar(unaSola), true, "con una sola, la segunda es la que enseña el ritmo");

  const yaAprendio = conciliar({
    saldoInicial: 5_000_000, saldoInicialFecha: "2026-08-01",
    conciliaciones: [
      { fecha: "2026-08-01", saldo_declarado: 4_000_000 },
      { fecha: "2026-08-11", saldo_declarado: 3_700_000 },
    ],
    movimientos: [], hoy: "2026-08-21",
  });
  assert.equal(
    convieneConciliar(yaAprendio),
    false,
    "una vez que aprendió el ritmo NO debe volver a molestar: esa es la filosofía",
  );
});

test("vuelve a preguntar recién cuando el dato quedó muy viejo", () => {
  const viejo = conciliar({
    saldoInicial: 5_000_000, saldoInicialFecha: "2026-06-01",
    conciliaciones: [
      { fecha: "2026-06-01", saldo_declarado: 4_000_000 },
      { fecha: "2026-06-11", saldo_declarado: 3_700_000 },
    ],
    movimientos: [], hoy: "2026-09-01",
  });

  assert.equal(convieneConciliar(viejo), true, "a los 60+ días sí conviene refrescar");
});
