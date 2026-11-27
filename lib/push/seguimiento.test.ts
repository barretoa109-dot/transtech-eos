import assert from "node:assert/strict";
import test from "node:test";

import * as seguimiento from "./seguimiento.ts";
import { avisoSemanal, diasActivos, diasActivosEnLaSemana, esLunes } from "./seguimiento.ts";

const HOY = "2026-11-16"; // lunes

test("una acción de las 22:00 de Asunción cuenta para ese día, no para el siguiente", () => {
  // 01:00 UTC del 17 son las 22:00 del 16 en Paraguay.
  assert.deepEqual([...diasActivos(["2026-11-17T01:00:00Z"])], ["2026-11-16"]);
});

test("marcas vacías o rotas no inventan días", () => {
  assert.equal(diasActivos([null, undefined, "", "no es una fecha"]).size, 0);
});

test("la semana mira los 7 días anteriores, sin contar hoy", () => {
  const dias = new Set([HOY, "2026-11-15", "2026-11-10", "2026-11-09", "2026-11-08"]);
  assert.equal(diasActivosEnLaSemana(dias, HOY), 3);
});

test("esLunes", () => {
  assert.equal(esLunes("2026-11-16"), true);
  assert.equal(esLunes("2026-11-15"), false);
});

test("el resumen semanal nunca reta y siempre entra entero", () => {
  const avisos = [0, 1, 2, 4, 5, 6, 7].map(avisoSemanal);
  assert.equal(avisos[0].titulo, "Semana nueva, cuenta nueva");
  assert.match(avisos[3].cuerpo, /4 de los últimos 7 días/);

  for (const aviso of avisos) {
    assert.ok(aviso.titulo.length <= 45, `título largo: ${aviso.titulo}`);
    assert.ok(aviso.cuerpo.length <= 150, `cuerpo largo (${aviso.cuerpo.length}): ${aviso.cuerpo}`);
    assert.doesNotMatch(aviso.cuerpo, /abandon|fallaste|deberías|Gs\.|₲/i);
  }
});

test("regla 4: no quedan rachas ni avisos de racha en riesgo", () => {
  // Si alguien las vuelve a agregar, que sea a propósito y cambiando esta prueba.
  for (const nombre of Object.keys(seguimiento)) assert.doesNotMatch(nombre, /racha/i, nombre);
  for (const activos of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const { titulo, cuerpo } = avisoSemanal(activos);
    assert.doesNotMatch(`${titulo} ${cuerpo}`, /racha|seguidos|se corta|en riesgo/i);
  }
});
