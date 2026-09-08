import assert from "node:assert/strict";
import test from "node:test";

import { armarPatrimonio, FALTAN_ACTIVOS, FALTAN_PASIVOS } from "./patrimonio.ts";

const HOY = "2026-09-08";

const BASE = {
  moneda: "PYG",
  hoy: HOY,
  cuentas: [
    { nombre: "Ueno", tipo: "banco", saldo: 12_000_000 as number | null, declarado_el: "2026-09-01" },
  ],
  bienes: [] as { nombre: string; tipo: string; valor: number; declarado_el: string | null }[],
  deudas: [
    { acreedor: "Financiera Ueno", tipo: "prestamo", saldo: 8_000_000, declarado_el: "2026-09-05" },
  ],
  pasivosConfirmados: true,
};

test("el neto es activos menos pasivos, y solo con las dos mitades", () => {
  const p = armarPatrimonio(BASE);

  assert.equal(p.activos, 12_000_000);
  assert.equal(p.pasivos, 8_000_000);
  assert.equal(p.neto, 4_000_000);
  assert.equal(p.falta, null);
});

test("sin saber si debe algo, no hay patrimonio neto", () => {
  /*
   * Sumar saldos y llamarlo neto es la forma más común de mentir en una app de
   * finanzas: alguien con 12 millones en el banco y 40 de préstamo lo tiene
   * NEGATIVO, y el número tranquilizador dice exactamente lo contrario.
   */
  const p = armarPatrimonio({ ...BASE, deudas: [], pasivosConfirmados: false });

  assert.equal(p.activos, 12_000_000);
  assert.equal(p.neto, null);
  assert.equal(p.falta, FALTAN_PASIVOS);
});

test("con las deudas ya preguntadas, una lista vacía sí significa cero", () => {
  const p = armarPatrimonio({ ...BASE, deudas: [], pasivosConfirmados: true });

  assert.equal(p.pasivos, 0);
  assert.equal(p.neto, 12_000_000);
});

test("sin activos tampoco hay neto: sería la deuda en negativo", () => {
  const p = armarPatrimonio({ ...BASE, cuentas: [] });

  assert.equal(p.neto, null);
  assert.equal(p.falta, FALTAN_ACTIVOS);
});

test("un neto puede ser negativo, y se dice", () => {
  const p = armarPatrimonio({
    ...BASE,
    deudas: [{ acreedor: "Financiera Ueno", tipo: "prestamo", saldo: 40_000_000, declarado_el: HOY }],
  });

  assert.equal(p.neto, -28_000_000);
});

test("una cuenta sin saldo declarado no entra como cero", () => {
  // Cero dice "no hay plata"; lo que pasa es que no sabemos cuánta hay.
  const p = armarPatrimonio({
    ...BASE,
    cuentas: [
      { nombre: "Ueno", tipo: "banco", saldo: 12_000_000, declarado_el: "2026-09-01" },
      { nombre: "Tigo Money", tipo: "billetera", saldo: null, declarado_el: null },
    ],
  });

  assert.equal(p.activos, 12_000_000);
  assert.equal(p.detalle_activos.length, 1);
  assert.ok(p.confianza.nivel < 1);
  assert.match(p.confianza.motivos.join(" "), /sin saldo declarado/);
});

test("los bienes declarados suman al activo y ordenan el detalle por peso", () => {
  const p = armarPatrimonio({
    ...BASE,
    bienes: [
      { nombre: "Casa de Lambaré", tipo: "inmueble", valor: 450_000_000, declarado_el: "2026-08-20" },
      { nombre: "Toyota Vitz", tipo: "vehiculo", valor: 45_000_000, declarado_el: "2026-08-20" },
    ],
  });

  assert.equal(p.activos, 507_000_000);
  assert.equal(p.detalle_activos[0].nombre, "Casa de Lambaré");
  assert.equal(p.neto, 499_000_000);
});

test("el patrimonio lleva la fecha del dato más viejo que lo compone", () => {
  /*
   * Un patrimonio armado con un saldo de marzo y una deuda de ayer no es de
   * hoy: es una mezcla de dos momentos, y el más viejo es el que manda.
   */
  const p = armarPatrimonio({
    ...BASE,
    cuentas: [{ nombre: "Ueno", tipo: "banco", saldo: 12_000_000, declarado_el: "2026-03-01" }],
  });

  assert.equal(p.desde_cuando, "2026-03-01");
  assert.equal(p.antiguedad_dias, 191);
  assert.ok(p.confianza.nivel < 0.8);
  assert.match(p.confianza.motivos.join(" "), /2026-03-01/);
});

test("sin bienes cargados lo dice, porque el número cambia mucho con ellos", () => {
  const p = armarPatrimonio(BASE);

  assert.match(p.confianza.motivos.join(" "), /casa, auto o inversiones/);
});
