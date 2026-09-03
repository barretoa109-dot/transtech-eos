import assert from "node:assert/strict";
import test from "node:test";
import { ejecutar, HERRAMIENTAS, type Contexto } from "./tools.ts";
import { calcularScore } from "../kpi/score.ts";
import type { PuntoHistoria } from "../kpi/historia.ts";
import type { ResultadoKPI } from "../kpi/tipos.ts";

function r(p: Partial<ResultadoKPI> & { id: string }): ResultadoKPI {
  return {
    id: p.id,
    nombre: p.nombre ?? p.id,
    familia: "ventas",
    unidad: p.unidad ?? "moneda",
    direccion: p.direccion ?? "mas_es_mejor",
    moneda: p.moneda ?? "PYG",
    valor: p.valor === undefined ? 700_000 : p.valor,
    anterior: null,
    variacion: null,
    variacion_pct: p.variacion_pct ?? null,
    tendencia: p.tendencia ?? "desconocida",
    estado: p.estado ?? "bien",
    periodo: { desde: "2026-09-01", hasta: "2026-09-15" },
    calculado_en: "2026-09-15",
    confianza: p.confianza ?? { nivel: 1, motivos: [] },
    falta: p.falta ?? null,
  };
}

function ctx(p: Partial<Contexto> = {}): Contexto {
  const resultados = p.resultados ?? [r({ id: "ventas_netas", nombre: "Ventas netas" })];
  return {
    resultados,
    anomalias: p.anomalias ?? [],
    score: p.score ?? null,
    hechos: p.hechos ?? {},
    periodo: p.periodo ?? { desde: "2026-09-01", hasta: "2026-09-15" },
    anterior: p.anterior ?? { desde: "2026-08-17", hasta: "2026-08-31" },
    series: p.series ?? new Map(),
    monedaPrincipal: p.monedaPrincipal ?? "PYG",
  };
}

test("todas las herramientas se declaran con nombre y descripción, y ninguna escribe", () => {
  assert.ok(HERRAMIENTAS.length > 0);
  for (const h of HERRAMIENTAS) {
    assert.ok(h.nombre.length > 0);
    assert.ok(h.descripcion.length > 20, `${h.nombre} necesita una descripción útil`);
    // Los nombres son de lectura: ver_, explicar_. Nada de crear_/registrar_.
    assert.match(h.nombre, /^(ver|explicar)_/, `${h.nombre} no parece de solo lectura`);
  }
});

test("ver_indicador devuelve el número ya formateado, no el crudo", () => {
  const res = ejecutar("ver_indicador", { id: "ventas_netas" }, ctx());
  assert.ok(res.ok);
  assert.match(res.texto, /700\.000/);
  assert.doesNotMatch(res.texto, /700000/);
});

test("un indicador sin valor dice por qué, en vez de un cero", () => {
  const c = ctx({
    resultados: [r({ id: "margen_bruto", nombre: "Margen bruto", valor: null, falta: "Ninguna venta tiene costo cargado" })],
  });
  const res = ejecutar("ver_indicador", { id: "margen_bruto" }, c);
  assert.ok(res.ok);
  assert.match(res.texto, /Ninguna venta tiene costo cargado/);
  assert.doesNotMatch(res.texto, /\b0\b/);
});

test("la confianza parcial se dice; la total no ensucia la respuesta", () => {
  const dudoso = ejecutar(
    "ver_indicador",
    { id: "ganancia" },
    ctx({ resultados: [r({ id: "ganancia", nombre: "Ganancia", confianza: { nivel: 0.6, motivos: ["6 de 15 ventas sin costo"] } })] }),
  );
  assert.ok(dudoso.ok);
  assert.match(dudoso.texto, /6 de 15 ventas sin costo/);

  const seguro = ejecutar("ver_indicador", { id: "ventas_netas" }, ctx());
  assert.ok(seguro.ok);
  assert.doesNotMatch(seguro.texto, /ojo/);
});

test("pedir un indicador inexistente devuelve la lista de los que sí existen", () => {
  const res = ejecutar("ver_indicador", { id: "ebitda" }, ctx());
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.match(res.error, /ventas_netas/);
  assert.match(res.error, /ebitda/);
});

test("una herramienta inexistente devuelve las disponibles, no un error mudo", () => {
  const res = ejecutar("borrar_todo", {}, ctx());
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.match(res.error, /ver_indicador/);
});

test("ver_salud aclara contra qué se compara el score", () => {
  const resultados = [r({ id: "ventas_netas", tendencia: "sube" })];
  const score = calcularScore(resultados, new Set(), "PYG");
  const res = ejecutar("ver_salud", {}, ctx({ resultados, score }));
  assert.ok(res.ok);
  assert.match(res.texto, /no contra ninguna industria/);
});

test("sin score, ver_salud dice qué falta en vez de inventar un número", () => {
  const res = ejecutar("ver_salud", {}, ctx({ score: null }));
  assert.ok(res.ok);
  assert.match(res.texto, /Todavía no hay con qué calcular/);
});

test("explicar_movimiento aclara SIEMPRE que es reparto y no causa", () => {
  const hechos = {
    productos: [{ id: "p1", nombre: "Taladro", moneda: "PYG", activo: true, controla_stock: true, stock_actual: 1, stock_minimo: 0, costo: null, iva: 10 as const }],
    ventas: [
      {
        id: "v1", fecha: "2026-08-20", moneda: "PYG", estado: "emitida" as const, contacto_id: null,
        contacto_nombre: null, total: 1100, vence_el: null, cobrado: 0,
        items: [{ total: 1100, iva: 10 as const, cantidad: 1, costo_unitario: null, producto_id: "p1" }],
      },
      {
        id: "v2", fecha: "2026-09-05", moneda: "PYG", estado: "emitida" as const, contacto_id: null,
        contacto_nombre: null, total: 110, vence_el: null, cobrado: 0,
        items: [{ total: 110, iva: 10 as const, cantidad: 1, costo_unitario: null, producto_id: "p1" }],
      },
    ],
  };
  const res = ejecutar("explicar_movimiento", {}, ctx({ hechos }));
  assert.ok(res.ok);
  assert.match(res.texto, /no su causa/);
  assert.match(res.texto, /Taladro/);
});

test("sin movimiento, explicar_movimiento lo dice y no fuerza una explicación", () => {
  const res = ejecutar("explicar_movimiento", {}, ctx({ hechos: { ventas: [] } }));
  assert.ok(res.ok);
  assert.match(res.texto, /no se movieron/);
});

test("ver_historia no afirma tendencia con menos de tres días", () => {
  const series = new Map<string, PuntoHistoria[]>([
    ["ventas_netas:PYG", [
      { fecha: "2026-09-01", valor: 10, confianza: 1, motivo: null },
      { fecha: "2026-09-02", valor: 20, confianza: 1, motivo: null },
    ]],
  ]);
  const res = ejecutar("ver_historia", { id: "ventas_netas" }, ctx({ series }));
  assert.ok(res.ok);
  assert.match(res.texto, /no alcanza para hablar de una tendencia/);
});

test("con racha suficiente, ver_historia la afirma con los días", () => {
  const series = new Map<string, PuntoHistoria[]>([
    ["ventas_netas:PYG", [
      { fecha: "2026-09-01", valor: 10, confianza: 1, motivo: null },
      { fecha: "2026-09-02", valor: 20, confianza: 1, motivo: null },
      { fecha: "2026-09-03", valor: 30, confianza: 1, motivo: null },
      { fecha: "2026-09-04", valor: 40, confianza: 1, motivo: null },
    ]],
  ]);
  const res = ejecutar("ver_historia", { id: "ventas_netas" }, ctx({ series }));
  assert.ok(res.ok);
  assert.match(res.texto, /3 días seguidos/);
});

test("sin historia cargada lo dice, en vez de responder como si tuviera datos", () => {
  const res = ejecutar("ver_historia", { id: "ventas_netas" }, ctx());
  assert.ok(res.ok);
  assert.match(res.texto, /Todavía no hay historia/);
});

test("ver_hallazgos se calla cuando no hay nada, en vez de decir 'todo en orden'", () => {
  const res = ejecutar("ver_hallazgos", {}, ctx({ anomalias: [] }));
  assert.ok(res.ok);
  assert.match(res.texto, /no detectó ninguna situación/);
});

test("sin datos cargados NO se dice que el indicador no existe: son cosas distintas", () => {
  const res = ejecutar("ver_indicador", { id: "ventas_netas" }, ctx({ resultados: [], monedaPrincipal: null }));
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.match(res.error, /Todavía no hay datos cargados/);
  assert.match(res.error, /No es que el indicador no exista/);
});

test("con datos cargados pero un id inventado, sí se dice que no existe", () => {
  const res = ejecutar("ver_indicador", { id: "ebitda" }, ctx());
  assert.ok(!res.ok);
  assert.match(res.error, /No existe el indicador "ebitda"/);
});
