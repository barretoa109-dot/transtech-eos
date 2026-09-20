import assert from "node:assert/strict";
import test from "node:test";

import { faltaLaColumna, validarCambios } from "./oportunidades.ts";

test("solo entra lo que vino: lo que no viene no se toca", () => {
  const r = validarCambios({ monto: 3500000 });
  assert.ok(r.ok);
  assert.deepEqual(r.cambios, { base: { monto: 3500000 }, nuevos: {} });
});

test("los campos de la v185 van aparte de los de siempre", () => {
  const r = validarCambios({ titulo: " Plan empresarial ", probabilidad: "60", producto_servicio: " Plan pro ", proxima_accion_en: "2026-09-25" });
  assert.ok(r.ok);
  assert.deepEqual(r.cambios.base, { titulo: "Plan empresarial" });
  assert.deepEqual(r.cambios.nuevos, { probabilidad: 60, producto_servicio: "Plan pro", proxima_accion_en: "2026-09-25" });
});

test("vacío o null es 'quitar este dato'", () => {
  const r = validarCambios({ probabilidad: null, producto_servicio: "", proxima_accion_en: "", cierre_estimado: null, detalle: "  " });
  assert.ok(r.ok);
  assert.deepEqual(r.cambios.nuevos, { probabilidad: null, producto_servicio: null, proxima_accion_en: null });
  assert.deepEqual(r.cambios.base, { cierre_estimado: null, detalle: null });
});

test("un 0 dicho a propósito es una probabilidad de 0, no 'quitar'", () => {
  const r = validarCambios({ probabilidad: 0 });
  assert.ok(r.ok);
  assert.equal(r.cambios.nuevos.probabilidad, 0);
});

test("una probabilidad fuera de rango, con decimales o no numérica se rechaza", () => {
  for (const probabilidad of [101, -1, 50.5, "mucha"]) {
    const r = validarCambios({ probabilidad });
    assert.ok(!r.ok, String(probabilidad));
    assert.equal(r.campo, "probabilidad");
  }
});

test("un día que no existe se rechaza, con qué campo es", () => {
  const a = validarCambios({ proxima_accion_en: "2026-02-31" });
  assert.ok(!a.ok);
  assert.equal(a.campo, "proxima_accion_en");
  const b = validarCambios({ cierre_estimado: "18/09/2026" });
  assert.ok(!b.ok);
  assert.equal(b.campo, "cierre_estimado");
});

test("un título vacío o un monto negativo se rechazan", () => {
  assert.ok(!validarCambios({ titulo: "   " }).ok);
  assert.ok(!validarCambios({ monto: -1 }).ok);
  assert.ok(!validarCambios({ monto: "abc" }).ok);
});

test("no vino nada: cambios vacíos, y quien llama decide si eso es un error", () => {
  const r = validarCambios({});
  assert.ok(r.ok);
  assert.deepEqual(r.cambios, { base: {}, nuevos: {} });
});

test("se reconoce el error de 'la columna todavía no existe'", () => {
  assert.equal(faltaLaColumna({ code: "42703" }), true);
  assert.equal(faltaLaColumna({ code: "PGRST204" }), true);
  assert.equal(faltaLaColumna({ code: "23505" }), false);
  assert.equal(faltaLaColumna(null), false);
});
