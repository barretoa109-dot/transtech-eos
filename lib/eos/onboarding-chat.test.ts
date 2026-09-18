import assert from "node:assert/strict";
import { test } from "node:test";

import {
  atenderOnboardingPorChat,
  decidirBienvenida,
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

test("decidirBienvenida: quien solo saluda ve cómo empezar", () => {
  assert.equal(decidirBienvenida("Hola"), "saludo");
  assert.equal(decidirBienvenida("¡Buenas tardes!"), "saludo");
  assert.equal(decidirBienvenida("hola, quiero empezar"), "saludo");
  assert.equal(decidirBienvenida(""), "saludo");
  assert.equal(decidirBienvenida("   "), "saludo");
});

test("decidirBienvenida: quien ya dijo algo va directo al chat, sin bienvenida encima", () => {
  assert.equal(decidirBienvenida("Vendí 2 remeras a 80 mil"), "directo");
  assert.equal(decidirBienvenida("hola, vendí 2 remeras"), "directo");
  assert.equal(decidirBienvenida("cuánto stock me queda de gaseosa"), "directo");
});

test("decidirBienvenida: quien pide ordenar su plata personal hace el cuestionario de siempre", () => {
  assert.equal(decidirBienvenida("mi plata"), "plata");
  assert.equal(decidirBienvenida("Hola, quiero ordenar mis finanzas"), "plata");
  assert.equal(decidirBienvenida("Ayudame con mis deudas"), "plata");
});

test("decidirBienvenida: un saludo largo con contenido no es solo un saludo", () => {
  assert.equal(decidirBienvenida("hola buenas tardes como estas quiero vender online"), "directo");
});

// Un cliente mínimo que recuerda qué se le escribió a eos_onboarding.
function clienteFalso(paso: string) {
  const escrituras: Array<Record<string, unknown>> = [];
  const cliente = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { paso }, error: null }) }) }),
      update: (fila: Record<string, unknown>) => {
        escrituras.push(fila);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { cliente: cliente as never, escrituras };
}

test('atenderOnboardingPorChat: un mensaje con contenido se atiende con el chat normal', async () => {
  const { cliente, escrituras } = clienteFalso('bienvenida');

  const respuesta = await atenderOnboardingPorChat(cliente, 'u1', 'Vendí 2 remeras a 80 mil');

  assert.equal(respuesta, null);
  assert.equal(escrituras.length, 1);
  assert.equal(escrituras[0].paso, 'completado');
  assert.ok(escrituras[0].completado_en);
});

test('atenderOnboardingPorChat: un saludo recibe cómo empezar y deja el onboarding completo', async () => {
  const { cliente, escrituras } = clienteFalso('bienvenida');

  const respuesta = await atenderOnboardingPorChat(cliente, 'u1', 'Hola');

  assert.match(String(respuesta), /Vendí 2 remeras/);
  assert.match(String(respuesta), /mi plata/);
  assert.equal(escrituras[0].paso, 'completado');
});

test('atenderOnboardingPorChat: pedir ordenar la plata arranca el cuestionario, sin completarlo', async () => {
  const { cliente, escrituras } = clienteFalso('bienvenida');

  const respuesta = await atenderOnboardingPorChat(cliente, 'u1', 'mi plata');

  assert.match(String(respuesta), /¿Dónde tenés tu plata?/);
  assert.equal(escrituras[0].paso, 'cuentas');
  assert.equal(escrituras[0].completado_en, undefined);
});
