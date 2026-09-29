import test from "node:test";
import assert from "node:assert/strict";

import { esPreguntaCuantoVendi, periodoDeLaPregunta, rangoDe, redactarCuantoVendi } from "./cuanto-vendi.ts";
import { respuestaDirectaPara } from "./respuestas-directas.ts";

test("reconoce la pregunta y su período", () => {
  const casos: [string, string][] = [
    ["¿cuánto vendí hoy?", "hoy"],
    ["cuanto vendi hoy", "hoy"],
    ["Cuánto facturé ayer?", "ayer"],
    ["¿cómo me fue hoy?", "hoy"],
    ["cuánto hice hoy", "hoy"],
    ["¿cuánto vendimos esta semana?", "semana"],
    ["cuanto vendi la semana pasada", "semana_pasada"],
    ["¿cuánto vendí este mes?", "mes"],
    ["cuánto facturamos el mes pasado?", "mes_pasado"],
    ["ventas de hoy", "hoy"],
    ["eos, ¿cómo vengo este mes?", "mes"],
  ];
  for (const [frase, periodo] of casos) assert.equal(periodoDeLaPregunta(frase), periodo, frase);
});

test("ante la duda, va al modelo", () => {
  for (const frase of [
    "¿cuánto vendí de lomitos hoy?",
    "¿cuánto gané este mes?",
    "vendí 3 bolsas hoy",
    "¿cuánto vendí?",
    "¿cuánto vendí hoy comparado con ayer y qué me conviene reponer para mañana?",
    "¿cómo me fue con Juan?",
  ]) {
    assert.equal(esPreguntaCuantoVendi(frase), false, frase);
  }
});

test("queda registrada entre las respuestas directas", () => {
  assert.equal(respuestaDirectaPara("¿cuánto vendí hoy?")?.clave, "cuanto_vendi");
  assert.equal(respuestaDirectaPara("¿quién me debe?")?.clave, "quien_me_debe");
});

test("los rangos: la semana arranca el lunes, el mes pasado es entero", () => {
  // 2026-10-01 es jueves.
  assert.deepEqual(rangoDe("hoy", "2026-10-01"), { desde: "2026-10-01", hasta: "2026-10-01", nombre: "Hoy" });
  assert.deepEqual(rangoDe("ayer", "2026-10-01"), { desde: "2026-09-30", hasta: "2026-09-30", nombre: "Ayer" });
  assert.deepEqual(rangoDe("semana", "2026-10-01"), { desde: "2026-09-28", hasta: "2026-10-01", nombre: "Esta semana" });
  assert.deepEqual(rangoDe("semana_pasada", "2026-10-01"), {
    desde: "2026-09-21",
    hasta: "2026-09-27",
    nombre: "La semana pasada",
  });
  assert.deepEqual(rangoDe("mes", "2026-10-01"), { desde: "2026-10-01", hasta: "2026-10-01", nombre: "Este mes" });
  assert.deepEqual(rangoDe("mes_pasado", "2026-10-01"), { desde: "2026-09-01", hasta: "2026-09-30", nombre: "El mes pasado" });
  // Un lunes, la semana es solo ese día.
  assert.equal(rangoDe("semana", "2026-09-28").desde, "2026-09-28");
});

test("redacta el total, lo fiado y lo que más salió", () => {
  const texto = redactarCuantoVendi("Hoy", [
    { total: 105000, moneda: "PYG", condicion: "contado", items: [{ descripcion: "Lomito árabe", cantidad: 3 }] },
    { total: "30000", moneda: "PYG", condicion: "credito", items: [{ descripcion: "Hamburguesa completa", cantidad: 1 }] },
    { total: 70000, moneda: "PYG", condicion: "contado", items: [{ descripcion: "Lomito árabe", cantidad: 2 }] },
  ]);
  const [primera, segunda, tercera] = texto.split("\n");
  assert.match(primera, /^Hoy vendiste ₲\s?205\.000 en 3 ventas\.$/);
  assert.match(segunda, /175\.000 al contado y .*30\.000 fiado\.$/);
  assert.equal(tercera, "Lo que más salió: Lomito árabe (5), Hamburguesa completa (1).");
});

test("sin ventas lo dice y enseña cómo anotar, sin inventar", () => {
  const texto = redactarCuantoVendi("Ayer", []);
  assert.match(texto, /^Ayer no tengo ninguna venta anotada\./);
});

test("guaraníes y dólares no se suman", () => {
  const texto = redactarCuantoVendi("Este mes", [
    { total: 100000, moneda: "PYG", condicion: "contado" },
    { total: 50, moneda: "USD", condicion: "contado" },
  ]);
  assert.match(texto, /vendiste .*100\.000 y .*50.* en 2 ventas/);
});
