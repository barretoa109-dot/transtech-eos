import assert from "node:assert/strict";
import test from "node:test";
import { scoresEOSPorDia, scoresPorDia, type FilaHistoriaScore } from "./scoreDiario.ts";

const DIMS = [
  { id: "a", nombre: "A", indicadores: ["x1", "x2"] },
  { id: "b", nombre: "B", indicadores: ["y1"] },
];
const UMBRALES = new Set(["x1", "x2", "y1"]);

function fila(fecha: string, indicador: string, estado: FilaHistoriaScore["estado"], moneda = "PYG"): FilaHistoriaScore {
  return { fecha, indicador, estado, moneda, confianza: 1 };
}

test("cada día se puntúa con los estados de ESE día, y la serie se mueve", () => {
  const serie = scoresPorDia(
    [
      fila("2026-09-20", "x1", "bien"),
      fila("2026-09-20", "x2", "bien"),
      fila("2026-09-20", "y1", "alerta"),
      fila("2026-09-21", "x1", "bien"),
      fila("2026-09-21", "x2", "bien"),
      fila("2026-09-21", "y1", "bien"),
    ],
    DIMS,
    UMBRALES,
  );
  // Día 1: dimensión A = 100, B = 20 → 60. Día 2: todo bien → 100.
  assert.deepEqual(serie, [
    { fecha: "2026-09-20", score: 60 },
    { fecha: "2026-09-21", score: 100 },
  ]);
});

test("un día sin nada puntuable es un hueco, no un cero", () => {
  const serie = scoresPorDia(
    [fila("2026-09-20", "x1", "sin_datos"), fila("2026-09-21", "x1", "atencion")],
    DIMS,
    UMBRALES,
  );
  assert.deepEqual(serie, [{ fecha: "2026-09-21", score: 55 }]);
});

test("ignora indicadores de otras dimensiones: lo personal no se cuela en el negocio", () => {
  const serie = scoresPorDia(
    [fila("2026-09-20", "x1", "bien"), fila("2026-09-20", "pers_otro", "alerta")],
    DIMS,
    UMBRALES,
  );
  assert.deepEqual(serie, [{ fecha: "2026-09-20", score: 100 }]);
});

test("puntúa en la moneda con más indicadores ese día", () => {
  const serie = scoresPorDia(
    [
      fila("2026-09-20", "x1", "bien", "PYG"),
      fila("2026-09-20", "x2", "bien", "PYG"),
      fila("2026-09-20", "y1", "alerta", "USD"),
    ],
    DIMS,
    UMBRALES,
  );
  assert.deepEqual(serie, [{ fecha: "2026-09-20", score: 100 }]);
});

test("el EOS Score del día promedia negocio y personal, o toma el único que haya", () => {
  const eos = scoresEOSPorDia({
    negocio: [
      { fecha: "2026-09-20", score: 40 },
      { fecha: "2026-09-21", score: 81 },
    ],
    personal: [
      { fecha: "2026-09-21", score: 60 },
      { fecha: "2026-09-22", score: 70 },
    ],
  });
  assert.deepEqual(
    [...eos],
    [
      ["2026-09-20", 40],
      ["2026-09-21", 71],
      ["2026-09-22", 70],
    ],
  );
});
