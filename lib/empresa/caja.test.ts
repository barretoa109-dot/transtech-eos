import test from "node:test";
import assert from "node:assert/strict";

import {
  DIAS_PARA_DESCONFIAR,
  DIAS_PARA_REVISAR,
  confianzaPorEdad,
  saldoDeHoy,
  saldosParaPronostico,
  type Caja,
  type MovimientoCaja,
} from "./caja.ts";

const HOY = "2026-09-04";

function dia(n: number): string {
  return new Date(Date.parse(`${HOY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function caja(p: Partial<Caja> = {}): Caja {
  return {
    id: p.id ?? "c1",
    nombre: p.nombre ?? "Caja chica",
    tipo: p.tipo ?? "efectivo",
    moneda: p.moneda ?? "PYG",
    saldo_declarado: "saldo_declarado" in p ? (p.saldo_declarado ?? null) : 5_000_000,
    saldo_declarado_el: "saldo_declarado_el" in p ? (p.saldo_declarado_el ?? null) : dia(-5),
    activa: p.activa ?? true,
  };
}

function mov(p: Partial<MovimientoCaja> = {}): MovimientoCaja {
  return { fecha: p.fecha ?? dia(-2), moneda: p.moneda ?? "PYG", monto: p.monto ?? 1_000_000 };
}

function una(cajas: Caja[], movimientos: MovimientoCaja[] = []) {
  const r = saldoDeHoy(cajas, movimientos, HOY);
  assert.equal(r.length, 1, "se esperaba una sola moneda");
  return r[0];
}

// ---------------------------------------------------------------------------
// La cuenta
// ---------------------------------------------------------------------------

test("el saldo es lo declarado más lo que entró y menos lo que salió después", () => {
  const s = una(
    [caja({ saldo_declarado: 5_000_000, saldo_declarado_el: dia(-10) })],
    [mov({ fecha: dia(-3), monto: 2_000_000 }), mov({ fecha: dia(-1), monto: -800_000 })],
  );

  assert.equal(s.declarado, 5_000_000);
  assert.equal(s.arrastrado, 1_200_000);
  assert.equal(s.saldo, 6_200_000);
});

test("un movimiento ANTERIOR a la declaración no se arrastra", () => {
  // Ya estaba contado adentro del saldo que declararon. Sumarlo sería contarlo
  // dos veces.
  const s = una(
    [caja({ saldo_declarado: 5_000_000, saldo_declarado_el: dia(-10) })],
    [mov({ fecha: dia(-20), monto: 9_000_000 })],
  );
  assert.equal(s.arrastrado, 0);
  assert.equal(s.saldo, 5_000_000);
});

test("un movimiento del MISMO día de la declaración tampoco", () => {
  // El saldo se declara al cierre del día: lo de ese día ya está adentro.
  const s = una(
    [caja({ saldo_declarado_el: dia(-5) })],
    [mov({ fecha: dia(-5), monto: 3_000_000 })],
  );
  assert.equal(s.arrastrado, 0);
});

test("varias cajas de la misma moneda suman su declarado una sola vez", () => {
  const s = una([
    caja({ id: "a", saldo_declarado: 2_000_000, saldo_declarado_el: dia(-3) }),
    caja({ id: "b", nombre: "Banco", tipo: "banco", saldo_declarado: 8_000_000, saldo_declarado_el: dia(-3) }),
  ]);
  assert.equal(s.declarado, 10_000_000);
  assert.equal(s.cajas, 2);
});

test("el arrastre se cuenta una vez por moneda, no una por caja", () => {
  // Contarlo por caja multiplicaría el mismo cobro por la cantidad de cajas.
  const s = una(
    [
      caja({ id: "a", saldo_declarado: 1_000_000, saldo_declarado_el: dia(-10) }),
      caja({ id: "b", saldo_declarado: 1_000_000, saldo_declarado_el: dia(-10) }),
    ],
    [mov({ fecha: dia(-2), monto: 500_000 })],
  );
  assert.equal(s.arrastrado, 500_000);
  assert.notEqual(s.arrastrado, 1_000_000, "el cobro se contó una vez por caja");
});

test("el arrastre arranca desde la declaración MÁS VIEJA", () => {
  // Usar la más nueva perdería los movimientos del medio, que sí faltan en la
  // caja vieja.
  const s = una(
    [
      caja({ id: "vieja", saldo_declarado: 1_000_000, saldo_declarado_el: dia(-30) }),
      caja({ id: "nueva", saldo_declarado: 1_000_000, saldo_declarado_el: dia(-1) }),
    ],
    [mov({ fecha: dia(-15), monto: 400_000 })],
  );
  assert.equal(s.arrastrado, 400_000);
});

// ---------------------------------------------------------------------------
// Lo que no se sabe no se cuenta
// ---------------------------------------------------------------------------

test("una caja sin saldo cargado NO cuenta como cero, y se avisa", () => {
  const s = una([caja({ saldo_declarado: null, saldo_declarado_el: null })]);
  assert.equal(s.cajas, 0);
  assert.equal(s.confianza, 0);
  assert.ok(s.avisos.some((a) => a.includes("no tiene saldo cargado")));
});

test("una caja cerrada no suma", () => {
  const r = saldoDeHoy([caja({ activa: false, saldo_declarado: 9_000_000 })], [], HOY);
  assert.equal(r.length, 0, "una caja cerrada apareció en el saldo");
});

test("un saldo declarado en cero SÍ cuenta: es un dato, no una ausencia", () => {
  const s = una([caja({ saldo_declarado: 0, saldo_declarado_el: dia(-1) })]);
  assert.equal(s.cajas, 1);
  assert.equal(s.saldo, 0);
  assert.ok(s.confianza > 0);
});

// ---------------------------------------------------------------------------
// La edad
// ---------------------------------------------------------------------------

test("la confianza baja con los días y no llega a cero", () => {
  assert.equal(confianzaPorEdad(0), 1);
  assert.ok(confianzaPorEdad(30) < 1);
  assert.ok(confianzaPorEdad(60) < confianzaPorEdad(30));
  assert.equal(confianzaPorEdad(DIAS_PARA_DESCONFIAR), 0.4);
  assert.equal(confianzaPorEdad(400), 0.4, "un saldo viejo sigue siendo mejor que ninguno");
});

test("avisa cuando el saldo tiene un mes, y con más fuerza a los tres", () => {
  const mes = una([caja({ saldo_declarado_el: dia(-DIAS_PARA_REVISAR - 1) })]);
  assert.ok(mes.avisos.some((a) => a.includes("días")));
  assert.ok(!mes.avisos.some((a) => a.includes("contar de nuevo")));

  const viejo = una([caja({ saldo_declarado_el: dia(-DIAS_PARA_DESCONFIAR - 1) })]);
  assert.ok(viejo.avisos.some((a) => a.includes("contar de nuevo")));
});

test("un saldo de ayer no arrastra avisos de antigüedad", () => {
  const s = una([caja({ saldo_declarado_el: dia(-1) })]);
  assert.ok(!s.avisos.some((a) => a.includes("días")));
  assert.equal(s.dias_del_mas_viejo, 1);
});

// ---------------------------------------------------------------------------
// Monedas
// ---------------------------------------------------------------------------

test("cada moneda va por su lado y nunca se suman", () => {
  const r = saldoDeHoy(
    [
      caja({ id: "a", moneda: "PYG", saldo_declarado: 5_000_000, saldo_declarado_el: dia(-2) }),
      caja({ id: "b", moneda: "USD", saldo_declarado: 300, saldo_declarado_el: dia(-2) }),
    ],
    [mov({ moneda: "USD", fecha: dia(-1), monto: 50 })],
    HOY,
  );

  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x.moneda === "PYG")?.saldo, 5_000_000, "un movimiento en USD tocó los guaraníes");
  assert.equal(r.find((x) => x.moneda === "USD")?.saldo, 350);
});

// ---------------------------------------------------------------------------
// Lo que se le pasa al pronóstico
// ---------------------------------------------------------------------------

test("al pronóstico solo van las monedas donde algo se declaró", () => {
  // Pasar un cero donde no se sabe haría que el pronóstico afirme un día de
  // quiebre que no puede saber.
  const saldos = saldoDeHoy(
    [
      caja({ id: "a", moneda: "PYG", saldo_declarado: 4_000_000, saldo_declarado_el: dia(-2) }),
      caja({ id: "b", moneda: "USD", saldo_declarado: null, saldo_declarado_el: null }),
    ],
    [],
    HOY,
  );

  const paraPronostico = saldosParaPronostico(saldos);
  assert.deepEqual(Object.keys(paraPronostico), ["PYG"]);
  assert.equal(paraPronostico.PYG, 4_000_000);
  assert.ok(!("USD" in paraPronostico), "se pasó un saldo que nadie declaró");
});

test("sin ninguna caja, el pronóstico no recibe nada", () => {
  assert.deepEqual(saldosParaPronostico(saldoDeHoy([], [], HOY)), {});
});
