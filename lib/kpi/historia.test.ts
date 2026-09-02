import assert from "node:assert/strict";
import test from "node:test";
import {
  diasSinPoderCalcular,
  filaDesdeResultado,
  frase,
  promedioReciente,
  rachaDe,
  type PuntoHistoria,
  type Serie,
} from "./historia.ts";
import type { ResultadoKPI } from "./tipos.ts";

function p(fecha: string, valor: number | null, confianza = 1): PuntoHistoria {
  return { fecha, valor, confianza, motivo: valor === null ? "sin costo" : null };
}

function serie(puntos: PuntoHistoria[]): Serie {
  return { indicador: "margen_bruto", moneda: "PYG", unidad: "porcentaje", puntos };
}

test("con un solo punto no hay racha: una foto no es una dirección", () => {
  assert.deepEqual(rachaDe([p("2026-09-01", 10)]), { direccion: "desconocida", dias: 0 });
});

test("la racha se cuenta desde el final, no la más larga de la historia", () => {
  // Sube cuatro días y ayer se dio vuelta: la racha vigente es de bajada, 1.
  const r = rachaDe([
    p("2026-09-01", 10),
    p("2026-09-02", 20),
    p("2026-09-03", 30),
    p("2026-09-04", 40),
    p("2026-09-05", 35),
  ]);
  assert.deepEqual(r, { direccion: "baja", dias: 1 });
  assert.notEqual(r.direccion, "sube");
});

test("cuatro subidas seguidas son una racha de cuatro", () => {
  assert.deepEqual(
    rachaDe([p("2026-09-01", 10), p("2026-09-02", 20), p("2026-09-03", 30), p("2026-09-04", 40), p("2026-09-05", 50)]),
    { direccion: "sube", dias: 4 },
  );
});

test("un día igual corta la racha: 'no se movió' no es evidencia de que siga subiendo", () => {
  const r = rachaDe([p("2026-09-01", 10), p("2026-09-02", 20), p("2026-09-03", 20)]);
  assert.equal(r.direccion, "estable");
  assert.equal(r.dias, 0);
});

test("los días sin valor no cortan la racha ni cuentan como cero", () => {
  // Si el día sin dato contara como 0, entre 20 y 30 habría una bajada y una
  // subida, y la racha se rompería con un movimiento que nunca pasó.
  const r = rachaDe([p("2026-09-01", 10), p("2026-09-02", 20), p("2026-09-03", null), p("2026-09-04", 30)]);
  assert.deepEqual(r, { direccion: "sube", dias: 2 });
});

test("la serie se ordena por fecha aunque llegue desordenada de la base", () => {
  const r = rachaDe([p("2026-09-03", 30), p("2026-09-01", 10), p("2026-09-02", 20)]);
  assert.deepEqual(r, { direccion: "sube", dias: 2 });
});

test("con menos de tres días de racha no se afirma nada", () => {
  assert.equal(frase(serie([p("2026-09-01", 10), p("2026-09-02", 20)])), null);
  assert.equal(frase(serie([p("2026-09-01", 10), p("2026-09-02", 20), p("2026-09-03", 30)])), null);
});

test("con tres días de racha sí, y la frase dice cuántos", () => {
  const s = serie([p("2026-09-01", 10), p("2026-09-02", 20), p("2026-09-03", 30), p("2026-09-04", 40)]);
  assert.equal(frase(s), "Viene subiendo hace 3 días seguidos.");
});

test("una serie plana no genera frase", () => {
  assert.equal(frase(serie([p("2026-09-01", 5), p("2026-09-02", 5), p("2026-09-03", 5)])), null);
});

test("el promedio reciente toma los últimos n con valor, salteando los vacíos", () => {
  const puntos = [p("2026-09-01", 100), p("2026-09-02", null), p("2026-09-03", 200), p("2026-09-04", 300)];
  assert.equal(promedioReciente(puntos, 2), 250);
  assert.equal(promedioReciente(puntos, 10), 200);
});

test("sin ningún valor el promedio es null, no cero", () => {
  assert.equal(promedioReciente([p("2026-09-01", null)], 3), null);
  assert.notEqual(promedioReciente([p("2026-09-01", null)], 3), 0);
});

test("los días sin poder calcular se cuentan desde hoy hacia atrás", () => {
  const puntos = [p("2026-09-01", 10), p("2026-09-02", null), p("2026-09-03", null), p("2026-09-04", null)];
  assert.equal(diasSinPoderCalcular(puntos), 3);
});

test("si hoy sí se pudo calcular, la cuenta es cero aunque antes hubiera huecos", () => {
  const puntos = [p("2026-09-01", null), p("2026-09-02", null), p("2026-09-03", 10)];
  assert.equal(diasSinPoderCalcular(puntos), 0);
});

test("la fila que se guarda es el mismo número que se mostró, incluido el null y su motivo", () => {
  const r: ResultadoKPI = {
    id: "margen_bruto",
    nombre: "Margen bruto",
    familia: "finanzas",
    unidad: "porcentaje",
    direccion: "mas_es_mejor",
    moneda: "PYG",
    valor: null,
    anterior: null,
    variacion: null,
    variacion_pct: null,
    tendencia: "desconocida",
    estado: "sin_datos",
    periodo: { desde: "2026-09-01", hasta: "2026-09-01" },
    calculado_en: "2026-09-01",
    confianza: { nivel: 0.4, motivos: ["9 de 15 ventas no tienen costo cargado"] },
    falta: "Ninguna venta del período tiene costo cargado",
  };

  assert.deepEqual(filaDesdeResultado("u1", "2026-09-01", r), {
    usuario_id: "u1",
    indicador: "margen_bruto",
    moneda: "PYG",
    fecha: "2026-09-01",
    valor: null,
    motivo: "Ninguna venta del período tiene costo cargado",
    familia: "finanzas",
    unidad: "porcentaje",
    estado: "sin_datos",
    confianza: 0.4,
  });
});
