import test from "node:test";
import assert from "node:assert/strict";

import {
  AJUSTE_MINIMO,
  MINIMO_PARA_PROYECTAR,
  esProyeccion,
  fechaProyectada,
  proyectar,
  type Proyeccion,
} from "./tendencia.ts";
import type { PuntoHistoria } from "../kpi/historia.ts";

const INICIO = "2026-08-01";

function fecha(n: number): string {
  return new Date(Date.parse(`${INICIO}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Una serie de `n` días donde el valor del día i lo decide `f`. */
function serie(n: number, f: (i: number) => number | null): PuntoHistoria[] {
  return Array.from({ length: n }, (_, i) => ({
    fecha: fecha(i),
    valor: f(i),
    confianza: 1,
    motivo: null,
  }));
}

function proyectada(puntos: PuntoHistoria[], horizonte = 30, extra: Record<string, unknown> = {}): Proyeccion {
  const r = proyectar({ indicador: "ventas", moneda: "PYG", puntos, horizonte, ...extra });
  assert.ok(esProyeccion(r), `se esperaba una proyección: ${"no_se_puede" in r ? r.no_se_puede : ""}`);
  return r;
}

// ---------------------------------------------------------------------------
// Los candados
// ---------------------------------------------------------------------------

test("con menos de dos semanas no se proyecta", () => {
  const r = proyectar({ indicador: "ventas", moneda: "PYG", puntos: serie(13, (i) => 100 + i), horizonte: 30 });
  assert.ok(!esProyeccion(r));
  assert.ok(!esProyeccion(r) && r.no_se_puede.includes(String(MINIMO_PARA_PROYECTAR)));
});

test("con exactamente el mínimo sí se proyecta", () => {
  const r = proyectar({
    indicador: "ventas",
    moneda: "PYG",
    puntos: serie(MINIMO_PARA_PROYECTAR, (i) => 100 + i * 10),
    horizonte: 10,
  });
  assert.ok(esProyeccion(r));
});

test("los días sin dato no cuentan para el mínimo", () => {
  // 20 días de calendario, pero solo 10 con dato.
  const r = proyectar({
    indicador: "ventas",
    moneda: "PYG",
    puntos: serie(20, (i) => (i % 2 === 0 ? 100 + i : null)),
    horizonte: 10,
  });
  assert.ok(!esProyeccion(r), "se proyectó sobre huecos rellenados");
});

test("una serie sin forma de recta se rechaza en vez de proyectarse", () => {
  // Sube y baja con fuerza: hay movimiento, pero no es una recta.
  const r = proyectar({
    indicador: "ventas",
    moneda: "PYG",
    puntos: serie(30, (i) => 1_000 + (i % 2 === 0 ? 900 : -900) + i),
    horizonte: 30,
  });
  assert.ok(!esProyeccion(r));
  assert.ok(!esProyeccion(r) && r.no_se_puede.includes("no sigue una línea"));
});

test("nunca devuelve un punto solo: siempre hay banda", () => {
  const p = proyectada(serie(30, (i) => 1_000 + i * 10 + (i % 3) * 25));
  assert.ok(p.minimo < p.valor && p.valor < p.maximo, "la banda tiene que contener al centro");
});

// ---------------------------------------------------------------------------
// Plana no es lo mismo que desconocida
// ---------------------------------------------------------------------------

test("una serie plana con ruido se proyecta como que se mantiene", () => {
  const p = proyectada(serie(30, (i) => 1_000 + (i % 3) * 20 - 20));
  assert.equal(p.forma, "se_mantiene");
  assert.ok(Math.abs(p.valor - 1_000) < 60, `se esperaba cerca de 1000 y dio ${p.valor}`);
});

test("una serie plana pasa aunque su ajuste sea malísimo", () => {
  const p = proyectada(serie(40, (i) => 500 + (i % 7) * 3));
  assert.ok(p.ajuste < AJUSTE_MINIMO, "esta serie no tiene forma de recta, y está bien");
  assert.equal(p.forma, "se_mantiene");
});

// ---------------------------------------------------------------------------
// La recta
// ---------------------------------------------------------------------------

test("una recta perfecta se proyecta exacta y con ajuste 1", () => {
  const p = proyectada(serie(30, (i) => 100 + i * 10), 10);
  // Último día i=29 → 390. Diez días después → 490.
  assert.ok(Math.abs(p.valor - 490) < 0.001, `dio ${p.valor}`);
  assert.equal(p.ajuste, 1);
  assert.equal(p.forma, "sube");
  assert.ok(Math.abs(p.maximo - p.minimo) < 0.001, "sin error no debería haber banda");
});

test("una serie que baja se reporta bajando", () => {
  const p = proyectada(serie(30, (i) => 5_000 - i * 50));
  assert.equal(p.forma, "baja");
  assert.ok(p.valor < 3_550);
});

test("la proyección arranca del último dato, no del primero", () => {
  const p = proyectada(serie(30, (i) => 100 + i * 10), 1);
  assert.ok(Math.abs(p.valor - 400) < 0.001, `dio ${p.valor}, se esperaba el día siguiente al último`);
});

test("un hueco largo pesa lo que dura, no un día", () => {
  // Treinta días de dato, un mes de silencio, y el valor sigue la misma recta.
  const puntos: PuntoHistoria[] = [
    ...serie(20, (i) => 100 + i * 10),
    { fecha: fecha(50), valor: 100 + 50 * 10, confianza: 1, motivo: null },
  ];
  // Solo 21 puntos válidos, pero el último está lejos.
  const p = proyectada(puntos, 10);
  assert.ok(Math.abs(p.valor - 700) < 1, `dio ${p.valor}: el hueco se trató como un día`);
});

// ---------------------------------------------------------------------------
// La banda se ensancha cuando corresponde
// ---------------------------------------------------------------------------

test("proyectar más lejos ensancha la banda", () => {
  const puntos = serie(30, (i) => 1_000 + i * 10 + (i % 4) * 30);
  const cerca = proyectada(puntos, 5);
  const lejos = proyectada(puntos, 60);
  assert.ok(lejos.maximo - lejos.minimo > cerca.maximo - cerca.minimo);
});

test("menos puntos dan una banda más ancha, no igual", () => {
  const ruido = (i: number) => 1_000 + i * 10 + ((i * 37) % 11) * 15;
  const pocos = proyectada(serie(15, ruido), 10);
  const muchos = proyectada(serie(60, ruido), 10);
  assert.ok(
    pocos.maximo - pocos.minimo > muchos.maximo - muchos.minimo,
    "con menos datos la banda tiene que ser más ancha",
  );
});

// ---------------------------------------------------------------------------
// Lo que se declara
// ---------------------------------------------------------------------------

test("siempre declara sus supuestos", () => {
  const p = proyectada(serie(30, (i) => 100 + i * 10));
  assert.ok(p.supuestos.length >= 2);
  assert.ok(p.supuestos.some((s) => s.includes("estacionalidad")));
});

test("avisa los días que no tuvieron dato", () => {
  const p = proyectada(serie(40, (i) => (i === 5 || i === 9 ? null : 100 + i * 10)));
  assert.ok(p.advertencias.some((a) => a.includes("2 días")));
});

test("avisa cuando el horizonte supera la historia", () => {
  const p = proyectada(serie(20, (i) => 100 + i * 10), 90);
  assert.ok(p.advertencias.some((a) => a.includes("cuanto más lejos")));
});

test("avisa cuando la recta lleva un porcentaje fuera de rango", () => {
  const p = proyectada(serie(30, (i) => 40 + i * 3), 60, { unidad: "porcentaje" });
  assert.ok(p.valor > 100);
  assert.ok(p.advertencias.some((a) => a.includes("no puede darse")));
});

test("avisa cuando la plata proyectada cruza a negativo", () => {
  const p = proyectada(serie(30, (i) => 3_000 - i * 100), 30, { unidad: "moneda" });
  assert.ok(p.valor < 0);
  assert.ok(p.advertencias.some((a) => a.includes("cruza a negativo")));
});

test("un indicador sano no arrastra advertencias de más", () => {
  const p = proyectada(serie(60, (i) => 1_000 + i * 5), 10);
  assert.deepEqual(p.advertencias, []);
});

// ---------------------------------------------------------------------------
// Fecha
// ---------------------------------------------------------------------------

test("la fecha proyectada cuelga del último día con dato", () => {
  const puntos = serie(10, (i) => (i >= 7 ? null : 100));
  assert.equal(fechaProyectada(puntos, 30), fecha(6 + 30));
});

test("sin datos no hay fecha que proyectar", () => {
  assert.equal(fechaProyectada(serie(5, () => null), 30), null);
});

test("todos los datos del mismo día no alcanzan", () => {
  const puntos: PuntoHistoria[] = Array.from({ length: 20 }, () => ({
    fecha: INICIO,
    valor: 100,
    confianza: 1,
    motivo: null,
  }));
  const r = proyectar({ indicador: "x", moneda: "PYG", puntos, horizonte: 10 });
  assert.ok(!esProyeccion(r));
  assert.ok(!esProyeccion(r) && r.no_se_puede.includes("mismo día"));
});
