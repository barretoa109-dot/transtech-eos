import assert from "node:assert/strict";
import test from "node:test";

import {
  avisoDeRacha,
  avisoRachaEnRiesgo,
  avisoSemanal,
  diasActivos,
  diasActivosEnLaSemana,
  esLunes,
  HITOS_DE_RACHA,
  rachaHasta,
} from "./seguimiento.ts";

const HOY = "2026-11-16"; // lunes

test("una acción de las 22:00 de Asunción cuenta para ese día, no para el siguiente", () => {
  // 01:00 UTC del 17 son las 22:00 del 16 en Paraguay.
  assert.deepEqual([...diasActivos(["2026-11-17T01:00:00Z"])], ["2026-11-16"]);
});

test("marcas vacías o rotas no inventan días", () => {
  assert.equal(diasActivos([null, undefined, "", "no es una fecha"]).size, 0);
});

test("la racha cuenta días seguidos y se corta en el primer hueco", () => {
  const dias = new Set(["2026-11-16", "2026-11-15", "2026-11-14", "2026-11-12"]);
  assert.equal(rachaHasta(dias, HOY), 3);
  assert.equal(rachaHasta(dias, "2026-11-13"), 0);
});

test("solo se festejan los hitos, no cada día", () => {
  assert.equal(avisoDeRacha(4), null);
  assert.equal(avisoDeRacha(0), null);
  for (const hito of HITOS_DE_RACHA) assert.ok(avisoDeRacha(hito), `falta el hito ${hito}`);
  assert.equal(avisoDeRacha(21)?.titulo, "21 días seguidos");
});

test("la racha en riesgo avisa solo si hay racha de verdad y hoy no se anotó", () => {
  const tresDias = new Set(["2026-11-15", "2026-11-14", "2026-11-13"]);
  assert.equal(avisoRachaEnRiesgo(tresDias, HOY)?.titulo, "Llevás 3 días seguidos");

  // Ya anotó hoy: no hay nada que cuidar.
  assert.equal(avisoRachaEnRiesgo(new Set([...tresDias, HOY]), HOY), null);
  // Dos días no es una racha que valga una notificación.
  assert.equal(avisoRachaEnRiesgo(new Set(["2026-11-15", "2026-11-14"]), HOY), null);
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

  const todos = [...avisos, ...HITOS_DE_RACHA.map((h) => avisoDeRacha(h)!), avisoRachaEnRiesgo(new Set(["2026-11-15", "2026-11-14", "2026-11-13"]), HOY)!];
  for (const aviso of todos) {
    assert.ok(aviso.titulo.length <= 45, `título largo: ${aviso.titulo}`);
    assert.ok(aviso.cuerpo.length <= 150, `cuerpo largo (${aviso.cuerpo.length}): ${aviso.cuerpo}`);
    assert.doesNotMatch(aviso.cuerpo, /abandon|fallaste|deberías|Gs\.|₲/i);
  }
});
