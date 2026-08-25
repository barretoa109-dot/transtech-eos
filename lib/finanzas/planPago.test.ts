import assert from "node:assert/strict";
import { test } from "node:test";

import {
  armarPlan,
  destinoDelExcedente,
  mesesParaSalir,
  ordenarPorConsecuencia,
} from "./planPago.ts";
import type { Deuda } from "./deudas.ts";

function deuda(parcial: Partial<Deuda> = {}): Deuda {
  return {
    acreedor: "Banco",
    tipo: "prestamo",
    moneda: "PYG",
    saldo_declarado: 6_000_000,
    saldo_declarado_el: "2026-08-01",
    cuota_monto: 500_000,
    cuota_dia: 5,
    cuotas_totales: 12,
    cuotas_pagadas: 0,
    tasa_anual: null,
    vence_el: null,
    estado: "al_dia",
    preocupa: false,
    ...parcial,
  } as Deuda;
}

test("cuando no alcanza, primero lo que más cuesta no pagar", () => {
  // No es lo mismo caer en mora con la SET que atrasarle una semana al tío.
  const orden = ordenarPorConsecuencia([
    deuda({ acreedor: "Tío Ramón", tipo: "familiar" }),
    deuda({ acreedor: "Proveedor", tipo: "proveedor" }),
    deuda({ acreedor: "SET", tipo: "impuesto" }),
    deuda({ acreedor: "Banco", tipo: "prestamo" }),
  ]);

  assert.deepEqual(
    orden.map((d) => d.acreedor),
    ["SET", "Banco", "Proveedor", "Tío Ramón"],
  );
});

test("lo ya atrasado va antes que todo: el daño ya empezó a correr", () => {
  const orden = ordenarPorConsecuencia([
    deuda({ acreedor: "SET", tipo: "impuesto" }),
    deuda({ acreedor: "Tío Ramón", tipo: "familiar", estado: "atrasada" }),
  ]);

  assert.equal(orden[0].acreedor, "Tío Ramón");
});

test("a igual consecuencia, primero la cuota más chica", () => {
  // Cubre más deudas con la misma plata y deja menos frentes abiertos.
  const orden = ordenarPorConsecuencia([
    deuda({ acreedor: "Banco grande", cuota_monto: 900_000 }),
    deuda({ acreedor: "Financiera", cuota_monto: 200_000, tipo: "prestamo" }),
  ]);

  assert.equal(orden[0].acreedor, "Financiera");
});

test("con plata de sobra el plan cubre todo y sobra excedente", () => {
  const plan = armarPlan({
    deudas: [deuda({ cuota_monto: 500_000 }), deuda({ acreedor: "Otro", cuota_monto: 300_000 })],
    capacidadMensual: 1_000_000,
  });

  assert.equal(plan.alcanza, true);
  assert.equal(plan.faltante, 0);
  assert.equal(plan.orden.length, 2);
  assert.equal(plan.excedente, 200_000);
});

test("cuando no alcanza, lo que queda afuera se marca para negociar", () => {
  const plan = armarPlan({
    deudas: [
      deuda({ acreedor: "SET", tipo: "impuesto", cuota_monto: 600_000 }),
      deuda({ acreedor: "Tío Ramón", tipo: "familiar", cuota_monto: 500_000 }),
    ],
    capacidadMensual: 700_000,
  });

  assert.equal(plan.alcanza, false);
  assert.deepEqual(plan.orden.map((p) => p.acreedor), ["SET"]);
  assert.deepEqual(plan.a_negociar, ["Tío Ramón"]);
  assert.equal(plan.faltante, 400_000);
});

test("NUNCA propone pagar media cuota", () => {
  // Pagar la mitad no evita la mora: solo gasta plata que servía para cubrir
  // otra cuota entera.
  const plan = armarPlan({
    deudas: [deuda({ acreedor: "Banco", cuota_monto: 500_000 })],
    capacidadMensual: 400_000,
  });

  assert.equal(plan.orden.length, 0);
  assert.deepEqual(plan.a_negociar, ["Banco"]);
});

test("sin capacidad, todo va a negociación y no hay excedente", () => {
  const plan = armarPlan({
    deudas: [deuda({ acreedor: "Banco", cuota_monto: 500_000 })],
    capacidadMensual: 0,
  });

  assert.equal(plan.alcanza, false);
  assert.equal(plan.excedente, 0);
  assert.equal(plan.destino_excedente, null);
  assert.equal(plan.meses_para_salir, null);
});

test("cada paso del plan explica por qué está ahí", () => {
  const plan = armarPlan({
    deudas: [deuda({ acreedor: "SET", tipo: "impuesto", cuota_monto: 300_000 })],
    capacidadMensual: 1_000_000,
  });

  assert.match(plan.orden[0].motivo, /multa/);
});

/* ==================== EL EXCEDENTE ==================== */

test("el excedente va a la deuda que el usuario dijo que le preocupa", () => {
  // Aunque no sea la más cara. Pagar un poco más de interés a cambio de que
  // duerma tranquilo es un buen negocio: la tranquilidad es el producto.
  const destino = destinoDelExcedente([
    deuda({ acreedor: "Banco caro", tasa_anual: 45 }),
    deuda({ acreedor: "Tío Ramón", tipo: "familiar", tasa_anual: 0, preocupa: true }),
  ]);

  assert.equal(destino?.acreedor, "Tío Ramón");
  assert.match(destino?.motivo ?? "", /preocupa/);
});

test("sin nada marcado, el excedente va a la tasa más alta", () => {
  const destino = destinoDelExcedente([
    deuda({ acreedor: "Banco barato", tasa_anual: 18 }),
    deuda({ acreedor: "Financiera", tasa_anual: 60 }),
  ]);

  assert.equal(destino?.acreedor, "Financiera");
  assert.match(destino?.motivo ?? "", /60% anual/);
});

test("sin tasas declaradas, a la que se puede terminar antes", () => {
  const destino = destinoDelExcedente([
    deuda({ acreedor: "Grande", saldo_declarado: 20_000_000 }),
    deuda({ acreedor: "Chica", saldo_declarado: 900_000 }),
  ]);

  assert.equal(destino?.acreedor, "Chica");
});

test("una deuda saldada no recibe el excedente", () => {
  const destino = destinoDelExcedente([
    deuda({ acreedor: "Saldada", estado: "saldada", preocupa: true }),
    deuda({ acreedor: "Viva", tasa_anual: 20 }),
  ]);

  assert.equal(destino?.acreedor, "Viva");
});

/* ==================== SALIDA ==================== */

test("estima en cuántos meses queda libre", () => {
  const meses = mesesParaSalir(
    [deuda({ saldo_declarado: 3_000_000 }), deuda({ saldo_declarado: 1_000_000 })],
    1_000_000,
  );

  assert.equal(meses, 4);
});

test("sin deudas, cero meses", () => {
  assert.equal(mesesParaSalir([], 500_000), 0);
});

test("sin capacidad no inventa una fecha de salida", () => {
  // Devolver un número enorme sería peor que decir "no sé": el usuario
  // merecería saber que con esta capacidad no sale nunca.
  assert.equal(mesesParaSalir([deuda()], 0), null);
});
