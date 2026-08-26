import assert from "node:assert/strict";
import { test } from "node:test";

import { etiquetarTramo, normalizarFecha, resolverPeriodo } from "./periodo.ts";

// Martes 25 de agosto de 2026.
const HOY = "2026-08-25";

test("la semana en curso arranca el lunes y termina hoy", () => {
  // No termina el domingo: un balance que incluye días que todavía no
  // pasaron muestra ceros donde va a haber gastos.
  const p = resolverPeriodo("semana", HOY);

  assert.equal(p.desde, "2026-08-24");
  assert.equal(p.hasta, "2026-08-25");
});

test("un lunes, la semana en curso es ese solo día", () => {
  const p = resolverPeriodo("semana", "2026-08-24");
  assert.equal(p.desde, "2026-08-24");
  assert.equal(p.hasta, "2026-08-24");
});

test("un domingo, la semana sigue empezando el lunes anterior", () => {
  // La semana paraguaya empieza el lunes. Con la convención de JS (domingo=0)
  // este es el caso que se rompe si nadie lo corrige.
  const p = resolverPeriodo("semana", "2026-08-30");
  assert.equal(p.desde, "2026-08-24");
  assert.equal(p.hasta, "2026-08-30");
});

test("la semana pasada va completa, de lunes a domingo", () => {
  const p = resolverPeriodo("semana_pasada", HOY);

  assert.equal(p.desde, "2026-08-17");
  assert.equal(p.hasta, "2026-08-23");
  assert.equal(p.etiqueta, "del 17 al 23 de agosto de 2026");
});

test("el mes en curso termina hoy; el mes pasado va entero", () => {
  assert.deepEqual(
    { d: resolverPeriodo("mes", HOY).desde, h: resolverPeriodo("mes", HOY).hasta },
    { d: "2026-08-01", h: "2026-08-25" },
  );

  const previo = resolverPeriodo("mes_pasado", HOY);
  assert.equal(previo.desde, "2026-07-01");
  assert.equal(previo.hasta, "2026-07-31");
});

test("el mes pasado en enero cruza el año", () => {
  const p = resolverPeriodo("mes_pasado", "2026-01-14");
  assert.equal(p.desde, "2025-12-01");
  assert.equal(p.hasta, "2025-12-31");
});

test("el mes pasado respeta febrero, incluido el bisiesto", () => {
  assert.equal(resolverPeriodo("mes_pasado", "2026-03-05").hasta, "2026-02-28");
  assert.equal(resolverPeriodo("mes_pasado", "2028-03-05").hasta, "2028-02-29");
});

test("el trimestre es el calendario, el que le sirve al contador", () => {
  // Agosto cae en el trimestre julio-septiembre.
  const p = resolverPeriodo("trimestre", HOY);
  assert.equal(p.desde, "2026-07-01");

  assert.equal(resolverPeriodo("trimestre", "2026-01-09").desde, "2026-01-01");
  assert.equal(resolverPeriodo("trimestre", "2026-12-31").desde, "2026-10-01");
});

test("un mes entero se nombra por su nombre, no por sus bordes", () => {
  // "julio de 2026" es como lo diría cualquiera; "del 1 al 31 de julio" no.
  assert.equal(resolverPeriodo("mes_pasado", HOY).etiqueta, "julio de 2026");
});

test("la etiqueta no repite el mes ni el año de más", () => {
  assert.equal(etiquetarTramo("2026-08-17", "2026-08-23"), "del 17 al 23 de agosto de 2026");
  assert.equal(etiquetarTramo("2026-07-28", "2026-08-04"), "del 28 de julio al 4 de agosto de 2026");
  assert.equal(
    etiquetarTramo("2025-12-30", "2026-01-05"),
    "del 30 de diciembre de 2025 al 5 de enero de 2026",
  );
  assert.equal(etiquetarTramo("2026-08-25", "2026-08-25"), "25 de agosto de 2026");
});

test("un rango personalizado dado vuelta se endereza, no falla", () => {
  const p = resolverPeriodo("personalizado", HOY, { desde: "2026-08-20", hasta: "2026-08-10" });
  assert.equal(p.desde, "2026-08-10");
  assert.equal(p.hasta, "2026-08-20");
});

test("un rango personalizado incompleto cae en el mes en curso", () => {
  const p = resolverPeriodo("personalizado", HOY, { desde: "2026-08-10" });
  assert.equal(p.desde, "2026-08-10");
  assert.equal(p.hasta, HOY);
});

test("rechaza fechas que parecen fechas pero no existen", () => {
  assert.equal(normalizarFecha("2026-13-01"), null);
  assert.equal(normalizarFecha("2026-02-30"), null);
  assert.equal(normalizarFecha("ayer"), null);
  assert.equal(normalizarFecha(""), null);
  assert.equal(normalizarFecha(null), null);
  assert.equal(normalizarFecha("2026-02-29"), null);
  assert.equal(normalizarFecha("2028-02-29"), "2028-02-29");
});
