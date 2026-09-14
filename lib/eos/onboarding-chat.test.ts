import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extraerDia,
  partirFragmentos,
  quiereSaltear,
  tipoDeCuenta,
  tipoDeDeuda,
} from "./onboarding-chat.ts";

test("quiereSaltear reconoce un 'no' pero no una cuenta que empieza distinto", () => {
  assert.equal(quiereSaltear("no"), true);
  assert.equal(quiereSaltear("No tengo"), true);
  assert.equal(quiereSaltear(""), true);
  assert.equal(quiereSaltear("   "), true);
  assert.equal(quiereSaltear("Banco Itaú"), false);
  assert.equal(quiereSaltear("no me acuerdo el nombre del banco"), false);
});

test("partirFragmentos separa por línea, coma y 'y'", () => {
  assert.deepEqual(partirFragmentos("Banco Itaú\nTigo Money"), ["Banco Itaú", "Tigo Money"]);
  assert.deepEqual(partirFragmentos("Banco Itaú, Tigo Money y efectivo"), [
    "Banco Itaú",
    "Tigo Money",
    "efectivo",
  ]);
});

test("partirFragmentos descarta fragmentos vacíos o de una letra", () => {
  assert.deepEqual(partirFragmentos("Banco Itaú,, a,"), ["Banco Itaú"]);
});

test("tipoDeCuenta clasifica por palabra clave, y 'otro' si no reconoce nada", () => {
  assert.equal(tipoDeCuenta("Banco Itaú"), "banco");
  assert.equal(tipoDeCuenta("Cooperativa Universitaria"), "cooperativa");
  assert.equal(tipoDeCuenta("Tigo Money"), "billetera");
  assert.equal(tipoDeCuenta("el efectivo del cajón"), "efectivo");
  assert.equal(tipoDeCuenta("mi tarjeta de crédito"), "tarjeta_credito");
  assert.equal(tipoDeCuenta("un sobre en casa"), "otro");
});

test("tipoDeDeuda clasifica por palabra clave, y 'otro' si no reconoce nada", () => {
  assert.equal(tipoDeDeuda("Tarjeta Visa Itaú"), "tarjeta");
  assert.equal(tipoDeDeuda("Préstamo personal Ueno"), "prestamo");
  assert.equal(tipoDeDeuda("le debo a mi hermano"), "familiar");
  assert.equal(tipoDeDeuda("un proveedor de mercadería"), "proveedor");
  assert.equal(tipoDeDeuda("un vecino"), "otro");
});

test("extraerDia lee el día del mes, o el 1 si no hay ninguno", () => {
  assert.equal(extraerDia("el 5 de cada mes"), 5);
  assert.equal(extraerDia("cada 28"), 28);
  assert.equal(extraerDia("sueldo"), 1);
  // 32 no es un día válido: el patrón exige 1-31, así que no matchea nada.
  assert.equal(extraerDia("el 32"), 1);
});
