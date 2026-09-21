import assert from "node:assert/strict";
import { test } from "node:test";

import { PIE_DE_AVISO_POR_CORREO, puedeAvisarPorCorreo } from "./avisarRiesgos.ts";

test("quien nunca tocó nada (sin fila) recibe el aviso por correo", () => {
  assert.equal(puedeAvisarPorCorreo(null), true);
  assert.equal(puedeAvisarPorCorreo(undefined), true);
});

test("una fila con el briefing apagado NO impide el aviso de riesgo", () => {
  // canal_email es el opt-in del briefing diario y no es de este permiso: apagado
  // (que es como nace) no debe callar un aviso de plata.
  assert.equal(puedeAvisarPorCorreo({ habilitado: true, avisos_riesgo_correo: true }), true);
  assert.equal(puedeAvisarPorCorreo({ habilitado: true, avisos_riesgo_correo: null }), true);
  assert.equal(puedeAvisarPorCorreo({}), true);
});

test("quien apagó los avisos de riesgo no los recibe", () => {
  assert.equal(puedeAvisarPorCorreo({ habilitado: true, avisos_riesgo_correo: false }), false);
});

test("quien apagó todo el seguimiento tampoco", () => {
  assert.equal(puedeAvisarPorCorreo({ habilitado: false, avisos_riesgo_correo: true }), false);
});

test("el pie del correo dice cómo dejar de recibirlo, sin datos de la persona", () => {
  assert.match(PIE_DE_AVISO_POR_CORREO, /Briefing/);
  assert.match(PIE_DE_AVISO_POR_CORREO, /desactivalo/);
  assert.ok(!/\d/.test(PIE_DE_AVISO_POR_CORREO), "el pie no debe llevar cifras");
});
