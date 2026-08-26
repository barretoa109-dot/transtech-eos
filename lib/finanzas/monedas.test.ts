import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agruparPorMoneda,
  codigoMoneda,
  ordenarMonedas,
  puntosDePartida,
  volumenPorMoneda,
} from "./monedas.ts";

test("una fila sin moneda cae en la del usuario, no en una moneda inventada", () => {
  const grupos = agruparPorMoneda(
    [{ moneda: null }, { moneda: "" }, { moneda: "usd" }, { moneda: "PYG" }],
    "PYG",
  );

  assert.deepEqual([...grupos.keys()].sort(), ["PYG", "USD"]);
  assert.equal(grupos.get("PYG")!.length, 3);
});

test("el código se normaliza a mayúsculas", () => {
  assert.equal(codigoMoneda("usd", "PYG"), "USD");
  assert.equal(codigoMoneda("  ", "PYG"), "PYG");
  assert.equal(codigoMoneda(undefined, "pyg"), "PYG");
});

test("la principal va primero aunque no sea la de mayor volumen", () => {
  // El usuario vive en guaraníes aunque ese mes haya movido más en dólares.
  const volumenes = new Map([
    ["USD", 5_000],
    ["PYG", 900],
    ["BRL", 2_000],
  ]);

  assert.deepEqual(ordenarMonedas(volumenes, "PYG"), ["PYG", "USD", "BRL"]);
});

test("la principal aparece aunque no tenga ni un movimiento", () => {
  assert.deepEqual(ordenarMonedas(new Map([["USD", 10]]), "PYG"), ["PYG", "USD"]);
});

test("la moneda principal parte del saldo de la Constitución", () => {
  const partidas = puntosDePartida({
    principal: "PYG",
    saldoInicial: 3_000_000,
    saldoInicialFecha: "2026-08-01",
    cuentas: [],
    primerMovimiento: new Map(),
    monedas: ["PYG"],
  });

  assert.deepEqual(partidas.get("PYG"), {
    base: 3_000_000,
    desde: "2026-08-01",
    origen: "constitucion",
  });
});

test("las otras monedas parten de lo declarado en las cuentas", () => {
  const partidas = puntosDePartida({
    principal: "PYG",
    saldoInicial: 0,
    saldoInicialFecha: "2026-08-01",
    cuentas: [
      { moneda: "USD", saldo_declarado: 400, saldo_declarado_el: "2026-08-10" },
      { moneda: "USD", saldo_declarado: 250, saldo_declarado_el: "2026-08-20" },
      { moneda: "PYG", saldo_declarado: 999, saldo_declarado_el: "2026-08-05" },
    ],
    primerMovimiento: new Map(),
    monedas: ["PYG", "USD"],
  });

  // La fecha de corte es la MÁS RECIENTE: arrancar el 10 contaría dos veces lo
  // que la cuenta declarada el 20 ya tenía incorporado.
  assert.deepEqual(partidas.get("USD"), { base: 650, desde: "2026-08-20", origen: "cuentas" });
});

test("una moneda sin cuenta declarada arranca en cero desde su primer movimiento", () => {
  // Es lo único honesto: EOS solo puede afirmar lo que vio pasar.
  const partidas = puntosDePartida({
    principal: "PYG",
    saldoInicial: 1_000,
    saldoInicialFecha: "2026-08-01",
    cuentas: [],
    primerMovimiento: new Map([["BRL", "2026-07-14"]]),
    monedas: ["PYG", "BRL"],
  });

  assert.deepEqual(partidas.get("BRL"), { base: 0, desde: "2026-07-14", origen: "sin_declarar" });
});

test("una cuenta declarada sin fecha no sirve para arrancar", () => {
  // Sin fecha no se sabe a qué movimientos ya está incorporado ese saldo.
  const partidas = puntosDePartida({
    principal: "PYG",
    saldoInicial: 0,
    saldoInicialFecha: "2026-08-01",
    cuentas: [{ moneda: "USD", saldo_declarado: 500, saldo_declarado_el: null }],
    primerMovimiento: new Map([["USD", "2026-06-01"]]),
    monedas: ["PYG", "USD"],
  });

  assert.equal(partidas.get("USD")!.origen, "sin_declarar");
  assert.equal(partidas.get("USD")!.base, 0);
});

test("el volumen no se deja engañar por los signos", () => {
  const volumenes = volumenPorMoneda(
    [
      { moneda: "USD", monto: 100 },
      { moneda: "USD", monto: -100 },
      { moneda: null, monto: 50 },
    ],
    "PYG",
  );

  assert.equal(volumenes.get("USD"), 200);
  assert.equal(volumenes.get("PYG"), 50);
});
