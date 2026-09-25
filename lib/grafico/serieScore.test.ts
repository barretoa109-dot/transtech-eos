import assert from "node:assert/strict";
import test from "node:test";
import { curvaD, diasEntre, masCercano, restarDias, resumir, unoPorDia, ventana, zona } from "./serieScore.ts";

test("un día con dos briefings cuenta una sola vez y vale el último", () => {
  const serie = unoPorDia([
    { fecha: "2026-09-20", score: 40 },
    { fecha: "2026-09-21", score: 50 },
    { fecha: "2026-09-21", score: 62 },
  ]);
  assert.deepEqual(serie, [
    { fecha: "2026-09-20", score: 40 },
    { fecha: "2026-09-21", score: 62 },
  ]);
});

test("ordena por fecha aunque lleguen desordenados y descarta basura", () => {
  const serie = unoPorDia([
    { fecha: "2026-09-22", score: 10 },
    { fecha: "2026-09-20", score: 30 },
    { fecha: "no-es-fecha", score: 5 },
    { fecha: "2026-09-21", score: Number.NaN },
  ]);
  assert.deepEqual(serie.map((p) => p.fecha), ["2026-09-20", "2026-09-22"]);
});

test("la ventana de 7 días incluye hoy y los 6 anteriores, nada más", () => {
  const serie = [
    { fecha: "2026-09-18", score: 1 },
    { fecha: "2026-09-19", score: 2 },
    { fecha: "2026-09-25", score: 3 },
  ];
  assert.deepEqual(ventana(serie, 7, "2026-09-25").map((p) => p.score), [2, 3]);
});

test("las fechas se restan sin correrse por el horario de verano", () => {
  assert.equal(restarDias("2026-10-05", 1), "2026-10-04");
  assert.equal(diasEntre("2026-09-01", "2026-10-01"), 30);
});

test("el resumen compara contra el primer punto del período", () => {
  const r = resumir([
    { fecha: "2026-09-20", score: 40 },
    { fecha: "2026-09-21", score: 70 },
    { fecha: "2026-09-22", score: 55 },
  ]);
  assert.deepEqual(r, { actual: 55, cambio: 15, promedio: 55, maximo: 70, minimo: 40 });
  assert.equal(resumir([{ fecha: "2026-09-20", score: 40 }])?.cambio, null);
  assert.equal(resumir([]), null);
});

test("las zonas cortan en 40 y 70", () => {
  assert.equal(zona(39), "bajo");
  assert.equal(zona(40), "medio");
  assert.equal(zona(70), "alto");
});

test("la curva no se pasa del punto más alto entre dos puntos", () => {
  const pts = [
    { x: 0, y: 100 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 100 },
  ];
  const numeros = curvaD(pts)
    .replace(/[MC]/g, " ")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const ys = numeros.filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) >= 0, "un control por debajo de 0 dibuja un valle que no existió");
  assert.ok(Math.max(...ys) <= 100);
});

test("la curva con uno o dos puntos no divide por cero", () => {
  assert.equal(curvaD([{ x: 5, y: 5 }]), "M5.0,5.0");
  assert.equal(curvaD([{ x: 0, y: 0 }, { x: 10, y: 10 }]), "M0.0,0.0 L10.0,10.0");
});

test("elige el punto más cercano al dedo", () => {
  assert.equal(masCercano([0, 50, 100], 70), 1);
  assert.equal(masCercano([0, 50, 100], 80), 2);
});
