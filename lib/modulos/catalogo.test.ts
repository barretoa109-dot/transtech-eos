import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diasRestantes,
  esCodigoModulo,
  nombreModulo,
  porVencer,
  DIAS_AVISO_VENCIMIENTO,
} from "./catalogo.ts";

const AHORA = new Date("2026-08-25T12:00:00Z");

function enDias(dias: number): string {
  return new Date(AHORA.getTime() + dias * 86_400_000).toISOString();
}

test("solo los códigos del catálogo son válidos", () => {
  assert.equal(esCodigoModulo("erp"), true);
  assert.equal(esCodigoModulo("crm"), true);
  assert.equal(esCodigoModulo("eerp"), false);
  assert.equal(esCodigoModulo(""), false);
});

test("un código desconocido no rompe el nombre que se muestra", () => {
  // Puede aparecer un módulo nuevo en la base antes de estar en el catálogo
  // de TypeScript. Mostrar algo legible es mejor que romper la pantalla.
  assert.equal(nombreModulo("erp"), "ERP");
  assert.equal(nombreModulo("facturacion"), "FACTURACION");
});

test("un módulo sin vencimiento nunca está por vencer", () => {
  // Es el caso de las cortesías y del uso interno del ecosistema TransTech.
  assert.equal(porVencer({ vencimiento: null }, AHORA), false);
  assert.equal(diasRestantes({ vencimiento: null }, AHORA), null);
});

test("avisa dentro de la ventana y no antes", () => {
  assert.equal(porVencer({ vencimiento: enDias(3) }, AHORA), true);
  assert.equal(porVencer({ vencimiento: enDias(DIAS_AVISO_VENCIMIENTO - 1) }, AHORA), true);
  assert.equal(porVencer({ vencimiento: enDias(DIAS_AVISO_VENCIMIENTO + 5) }, AHORA), false);
});

test("un módulo YA vencido no se anuncia como 'por vencer'", () => {
  // Ya no es un aviso, es otro estado: decirle "te vence pronto" a alguien que
  // ya perdió el acceso es peor que no decir nada.
  assert.equal(porVencer({ vencimiento: enDias(-1) }, AHORA), false);
  assert.equal(diasRestantes({ vencimiento: enDias(-3) }, AHORA), -3);
});

test("los días restantes se redondean hacia arriba", () => {
  // A las 12 del mediodía, algo que vence mañana a la mañana todavía es "1
  // día", no "0". Mostrar 0 días de algo que sigue funcionando confunde.
  const manana = new Date(AHORA.getTime() + 20 * 3_600_000).toISOString();
  assert.equal(diasRestantes({ vencimiento: manana }, AHORA), 1);
});
