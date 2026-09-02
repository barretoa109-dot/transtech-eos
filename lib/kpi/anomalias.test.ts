import assert from "node:assert/strict";
import test from "node:test";
import { detectarAnomalias, novedosas, ordenar, type Anomalia } from "./anomalias.ts";
import type { PuntoHistoria } from "./historia.ts";
import type { ResultadoKPI } from "./tipos.ts";

function r(p: Partial<ResultadoKPI> = {}): ResultadoKPI {
  return {
    id: p.id ?? "ventas_netas",
    nombre: p.nombre ?? "Ventas netas",
    familia: p.familia ?? "ventas",
    unidad: p.unidad ?? "moneda",
    direccion: p.direccion ?? "mas_es_mejor",
    moneda: p.moneda ?? "PYG",
    valor: p.valor === undefined ? 100 : p.valor,
    anterior: p.anterior ?? null,
    variacion: p.variacion ?? null,
    variacion_pct: p.variacion_pct ?? null,
    tendencia: p.tendencia ?? "desconocida",
    estado: p.estado ?? "bien",
    periodo: { desde: "2026-09-01", hasta: "2026-09-15" },
    calculado_en: "2026-09-15",
    confianza: p.confianza ?? { nivel: 1, motivos: [] },
    falta: p.falta ?? null,
  };
}

function p(fecha: string, valor: number | null): PuntoHistoria {
  return { fecha, valor, confianza: 1, motivo: null };
}

test("un indicador en alerta es una anomalía crítica, sin necesitar historia", () => {
  const a = detectarAnomalias([{ resultado: r({ estado: "alerta", valor: 71 }) }]);
  assert.equal(a.length, 1);
  assert.equal(a[0].severidad, "critico");
  assert.equal(a[0].clase, "hecho");
});

test("un indicador tranquilo no genera nada: el silencio también es información", () => {
  assert.deepEqual(detectarAnomalias([{ resultado: r({ estado: "bien" }) }]), []);
});

test("una racha para el lado malo se detecta; para el lado bueno no molesta", () => {
  const bajando = [p("2026-09-01", 100), p("2026-09-02", 90), p("2026-09-03", 80), p("2026-09-04", 70)];

  // Ventas bajando: mala noticia.
  const malas = detectarAnomalias([
    { resultado: r({ direccion: "mas_es_mejor", valor: 70 }), puntos: bajando },
  ]);
  assert.ok(malas.some((x) => x.clave.startsWith("racha:")));

  // Cobros demorados bajando: buena noticia, no es una anomalía.
  const buenas = detectarAnomalias([
    { resultado: r({ id: "cobros_demorados", direccion: "menos_es_mejor", valor: 70 }), puntos: bajando },
  ]);
  assert.ok(!buenas.some((x) => x.clave.startsWith("racha:")));
});

test("una racha de dos días no alcanza para avisar", () => {
  const corta = [p("2026-09-01", 100), p("2026-09-02", 90), p("2026-09-03", 80)];
  const a = detectarAnomalias([{ resultado: r({ valor: 80 }), puntos: corta }]);
  assert.ok(!a.some((x) => x.clave.startsWith("racha:")));
});

test("la clave de la racha incluye los días: que se alargue es una noticia nueva", () => {
  const tres = [p("2026-09-01", 100), p("2026-09-02", 90), p("2026-09-03", 80), p("2026-09-04", 70)];
  const cuatro = [...tres, p("2026-09-05", 60)];

  const a3 = detectarAnomalias([{ resultado: r({ valor: 70 }), puntos: tres }]).find((x) =>
    x.clave.startsWith("racha:"),
  );
  const a4 = detectarAnomalias([{ resultado: r({ valor: 60 }), puntos: cuatro }]).find((x) =>
    x.clave.startsWith("racha:"),
  );

  assert.notEqual(a3?.clave, a4?.clave);
});

test("siete días sin poder calcular es su propio problema", () => {
  const puntos = [p("2026-09-01", 50), ...Array.from({ length: 8 }, (_, i) => p(`2026-09-${String(i + 2).padStart(2, "0")}`, null))];
  const a = detectarAnomalias([
    { resultado: r({ id: "margen_bruto", valor: null, falta: "Ninguna venta tiene costo cargado" }), puntos },
  ]);
  const hallazgo = a.find((x) => x.clave.startsWith("sin-datos:"));
  assert.ok(hallazgo);
  assert.match(hallazgo.titulo, /8 días/);
  assert.equal(hallazgo.evidencia, "Ninguna venta tiene costo cargado");
});

test("apartarse del promedio para el lado bueno se marca como oportunidad, no como alerta", () => {
  const puntos = [p("2026-09-01", 100), p("2026-09-02", 100), p("2026-09-03", 100), p("2026-09-04", 100)];
  const a = detectarAnomalias([{ resultado: r({ valor: 200 }), puntos }]);
  const desvio = a.find((x) => x.clave.startsWith("desvio:"));
  assert.ok(desvio);
  assert.equal(desvio.severidad, "oportunidad");
  assert.match(desvio.titulo, /100% por encima/);
});

test("un desvío chico no es noticia", () => {
  const puntos = [p("2026-09-01", 100), p("2026-09-02", 100), p("2026-09-03", 100), p("2026-09-04", 100)];
  const a = detectarAnomalias([{ resultado: r({ valor: 110 }), puntos }]);
  assert.ok(!a.some((x) => x.clave.startsWith("desvio:")));
});

test("la confianza baja empuja el hallazgo hacia abajo, no lo dispara igual", () => {
  const seguro = detectarAnomalias([
    { resultado: r({ estado: "alerta", confianza: { nivel: 1, motivos: [] } }) },
  ])[0];
  const dudoso = detectarAnomalias([
    { resultado: r({ estado: "alerta", confianza: { nivel: 0.5, motivos: ["mitad de las ventas sin costo"] } }) },
  ])[0];

  assert.ok(dudoso.prioridad < seguro.prioridad);
  assert.equal(dudoso.prioridad, Number((seguro.prioridad * 0.5).toFixed(3)));
});

test("lo crítico va antes que lo de atención, y eso antes que una oportunidad", () => {
  const hechas: Anomalia[] = [
    { clave: "c", indicador: "x", moneda: "PYG", severidad: "oportunidad", clase: "hecho", titulo: "", evidencia: "", prioridad: 0.4 },
    { clave: "a", indicador: "x", moneda: "PYG", severidad: "critico", clase: "hecho", titulo: "", evidencia: "", prioridad: 1 },
    { clave: "b", indicador: "x", moneda: "PYG", severidad: "atencion", clase: "hecho", titulo: "", evidencia: "", prioridad: 0.65 },
  ];
  assert.deepEqual(ordenar(hechas).map((x) => x.clave), ["a", "b", "c"]);
});

test("lo ya avisado no se repite, pero un problema nuevo sí pasa", () => {
  const a: Anomalia[] = [
    { clave: "umbral:x", indicador: "x", moneda: "PYG", severidad: "critico", clase: "hecho", titulo: "", evidencia: "", prioridad: 1 },
    { clave: "umbral:y", indicador: "y", moneda: "PYG", severidad: "critico", clase: "hecho", titulo: "", evidencia: "", prioridad: 1 },
  ];
  assert.deepEqual(novedosas(a, ["umbral:x"]).map((x) => x.clave), ["umbral:y"]);
});

test("un indicador sin historia igual se evalúa por su umbral", () => {
  const a = detectarAnomalias([{ resultado: r({ estado: "alerta" }) }]);
  assert.equal(a.length, 1);
});

test("todo lo que sale del detector es un hecho, nunca una causa inventada", () => {
  const puntos = [p("2026-09-01", 100), p("2026-09-02", 90), p("2026-09-03", 80), p("2026-09-04", 70)];
  const a = detectarAnomalias([{ resultado: r({ estado: "alerta", valor: 70 }), puntos }]);
  assert.ok(a.length > 0);
  for (const x of a) assert.equal(x.clase, "hecho");
});
