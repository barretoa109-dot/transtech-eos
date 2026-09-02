import assert from "node:assert/strict";
import test from "node:test";
import { armarTwin, convieneEscribir, huella, monedaPrincipal, scorePrincipal } from "./twin.ts";
import { calcularScore } from "./score.ts";
import type { Anomalia } from "./anomalias.ts";
import type { ResultadoKPI } from "./tipos.ts";

function r(p: Partial<ResultadoKPI> & { id: string }): ResultadoKPI {
  return {
    id: p.id,
    nombre: p.nombre ?? p.id,
    familia: p.familia ?? "ventas",
    unidad: p.unidad ?? "moneda",
    direccion: p.direccion ?? "mas_es_mejor",
    moneda: p.moneda ?? "PYG",
    valor: p.valor === undefined ? 100 : p.valor,
    anterior: null,
    variacion: null,
    variacion_pct: null,
    tendencia: p.tendencia ?? "sube",
    estado: p.estado ?? "bien",
    periodo: { desde: "2026-09-01", hasta: "2026-09-15" },
    calculado_en: "2026-09-15",
    confianza: p.confianza ?? { nivel: 1, motivos: [] },
    falta: p.falta ?? null,
  };
}

function anomalia(p: Partial<Anomalia> & { clave: string }): Anomalia {
  return {
    clave: p.clave,
    indicador: p.indicador ?? "ventas_netas",
    moneda: "PYG",
    severidad: p.severidad ?? "atencion",
    clase: "hecho",
    titulo: p.titulo ?? "Algo pasó",
    evidencia: p.evidencia ?? "Con estos números",
    prioridad: p.prioridad ?? 0.5,
  };
}

const SIN_UMBRALES = new Set<string>();

test("la huella no depende de la hora: dos corridas del mismo día con los mismos datos dan lo mismo", () => {
  const datos = [r({ id: "ventas_netas", valor: 100 })];
  assert.equal(huella(datos), huella(datos));
});

test("la huella cambia cuando cambia un valor", () => {
  assert.notEqual(
    huella([r({ id: "ventas_netas", valor: 100 })]),
    huella([r({ id: "ventas_netas", valor: 200 })]),
  );
});

test("la huella no depende del orden en que vengan los indicadores", () => {
  const a = [r({ id: "ventas_netas" }), r({ id: "margen_bruto" })];
  const b = [r({ id: "margen_bruto" }), r({ id: "ventas_netas" })];
  assert.equal(huella(a), huella(b));
});

test("con la misma huella no se reescribe el gemelo", () => {
  const resultados = [r({ id: "ventas_netas" })];
  const score = calcularScore(resultados, SIN_UMBRALES, "PYG");
  const fila = armarTwin({ usuarioId: "u1", resultados, anomalias: [], score, generadoEn: "2026-09-15T10:00:00Z" });

  assert.equal(convieneEscribir(fila, fila.source_fingerprint), false);
  assert.equal(convieneEscribir(fila, null), true);
  assert.equal(convieneEscribir(fila, "otra"), true);
});

test("solo los riesgos críticos y de atención van a risks, no las oportunidades", () => {
  const resultados = [r({ id: "ventas_netas" })];
  const score = calcularScore(resultados, SIN_UMBRALES, "PYG");
  const fila = armarTwin({
    usuarioId: "u1",
    resultados,
    anomalias: [
      anomalia({ clave: "a", severidad: "critico" }),
      anomalia({ clave: "b", severidad: "oportunidad" }),
      anomalia({ clave: "c", severidad: "info" }),
    ],
    score,
    generadoEn: "2026-09-15T10:00:00Z",
  });

  const claves = (fila.risks as { clave: string }[]).map((x) => x.clave);
  assert.deepEqual(claves, ["a"]);
});

test("el estado actual conserva el motivo cuando un indicador no tiene valor", () => {
  const resultados = [r({ id: "margen_bruto", valor: null, falta: "Ninguna venta tiene costo cargado" })];
  const score = calcularScore(resultados, SIN_UMBRALES, "PYG");
  const fila = armarTwin({ usuarioId: "u1", resultados, anomalias: [], score, generadoEn: "x" });

  const ind = (fila.current_state as { indicadores: { falta: string | null }[] }).indicadores[0];
  assert.equal(ind.falta, "Ninguna venta tiene costo cargado");
});

test("los campos que no se pueden llenar con verdad quedan documentados en la fila", () => {
  const resultados = [r({ id: "ventas_netas" })];
  const score = calcularScore(resultados, SIN_UMBRALES, "PYG");
  const fila = armarTwin({ usuarioId: "u1", resultados, anomalias: [], score, generadoEn: "x" });

  const sinLlenar = (fila.metadata as { sin_llenar: Record<string, string> }).sin_llenar;
  // Los nueve campos que quedan en null tienen que explicar por qué.
  for (const campo of [
    "identity", "desired_state", "gaps", "constraints", "capabilities",
    "opportunities", "execution_profile", "learning_profile", "autonomy_profile",
  ]) {
    assert.ok(sinLlenar[campo], `falta explicar ${campo}`);
    assert.ok(sinLlenar[campo].length > 20, `la explicación de ${campo} es demasiado corta`);
  }
});

test("el score, su confianza y su cobertura viajan en las columnas propias de la tabla", () => {
  const resultados = [r({ id: "ventas_netas", tendencia: "sube" })];
  const score = calcularScore(resultados, SIN_UMBRALES, "PYG");
  const fila = armarTwin({ usuarioId: "u1", resultados, anomalias: [], score, generadoEn: "x" });

  assert.equal(fila.intelligence_score, score.puntaje);
  assert.equal(fila.confidence, score.confianza);
  assert.equal(fila.source_completeness, score.cobertura);
});

test("la moneda principal es la que tiene más indicadores, no la primera alfabética", () => {
  const resultados = [
    r({ id: "a", moneda: "USD" }),
    r({ id: "b", moneda: "PYG" }),
    r({ id: "c", moneda: "PYG" }),
  ];
  assert.equal(monedaPrincipal(resultados), "PYG");
});

test("sin indicadores no hay moneda ni score, y no explota", () => {
  assert.equal(monedaPrincipal([]), null);
  assert.equal(scorePrincipal([], SIN_UMBRALES), null);
});

test("las prioridades se cortan en cinco: una lista larga no se lee", () => {
  const resultados = [r({ id: "ventas_netas" })];
  const score = calcularScore(resultados, SIN_UMBRALES, "PYG");
  const fila = armarTwin({
    usuarioId: "u1",
    resultados,
    anomalias: Array.from({ length: 9 }, (_, i) => anomalia({ clave: `k${i}` })),
    score,
    generadoEn: "x",
  });
  assert.equal((fila.priorities as unknown[]).length, 5);
});
