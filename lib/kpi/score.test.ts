import assert from "node:assert/strict";
import test from "node:test";
import { avisoDeCobertura, calcularScore, DIMENSIONES, explicarCambio, METODOLOGIA } from "./score.ts";
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

const SIN_UMBRALES = new Set<string>();

test("un indicador sin umbral y sin período anterior NO puntúa: no aporta relleno", () => {
  const s = calcularScore([r({ id: "ventas_netas", tendencia: "desconocida" })], SIN_UMBRALES, "PYG");
  assert.equal(s.puntaje, null);
  assert.equal(s.cobertura, 0);
});

test("una tendencia buena puntúa alto y una mala puntúa bajo, según la dirección del indicador", () => {
  const sube = calcularScore(
    [r({ id: "ventas_netas", direccion: "mas_es_mejor", tendencia: "sube" })],
    SIN_UMBRALES,
    "PYG",
  );
  const baja = calcularScore(
    [r({ id: "ventas_netas", direccion: "mas_es_mejor", tendencia: "baja" })],
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(sube.puntaje, 100);
  assert.equal(baja.puntaje, 20);
});

test("para un indicador de menos_es_mejor, bajar es la buena noticia", () => {
  const s = calcularScore(
    [r({ id: "cobros_demorados", direccion: "menos_es_mejor", tendencia: "baja" })],
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(s.puntaje, 100);
});

test("un indicador neutro no puntúa por tendencia: no hay lado bueno", () => {
  const s = calcularScore(
    [r({ id: "ticket_promedio", direccion: "neutro", tendencia: "sube" })],
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(s.puntaje, null);
});

test("estable tampoco puntúa: no moverse no es bueno ni malo", () => {
  const s = calcularScore(
    [r({ id: "ventas_netas", tendencia: "estable" })],
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(s.puntaje, null);
});

test("el umbral declarado aporta su propio componente, además de la tendencia", () => {
  const s = calcularScore(
    [r({ id: "concentracion_clientes", direccion: "menos_es_mejor", estado: "alerta", tendencia: "sube" })],
    new Set(["concentracion_clientes"]),
    "PYG",
  );
  const dim = s.dimensiones.find((d) => d.id === "clientes");
  assert.equal(dim?.componentes.length, 2);
  assert.deepEqual(dim?.componentes.map((c) => c.tipo).sort(), ["tendencia", "umbral"]);
  // alerta (20) y tendencia mala (20) -> 20.
  assert.equal(dim?.puntaje, 20);
});

test("la cobertura dice sobre cuántas dimensiones se calculó", () => {
  const s = calcularScore(
    [
      r({ id: "ventas_netas", tendencia: "sube" }),
      r({ id: "margen_bruto", tendencia: "sube" }),
    ],
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(s.cobertura, Number((2 / DIMENSIONES.length).toFixed(3)));
  assert.ok(s.cobertura < 1);
});

test("una dimensión sin datos dice por qué, en vez de puntuar cero", () => {
  const s = calcularScore([r({ id: "ventas_netas", tendencia: "sube" })], SIN_UMBRALES, "PYG");
  const inventario = s.dimensiones.find((d) => d.id === "inventario");
  assert.equal(inventario?.puntaje, null);
  assert.ok(inventario?.motivo);
  assert.notEqual(inventario?.puntaje, 0);
});

test("con cobertura baja aparece la advertencia; con cobertura alta no", () => {
  const flaco = calcularScore([r({ id: "ventas_netas", tendencia: "sube" })], SIN_UMBRALES, "PYG");
  assert.ok(avisoDeCobertura(flaco));

  const completo = calcularScore(
    DIMENSIONES.flatMap((d) => d.indicadores.map((id) => r({ id, tendencia: "sube" }))),
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(completo.cobertura, 1);
  assert.equal(avisoDeCobertura(completo), null);
});

test("nunca se suman monedas: el score es de una moneda por vez", () => {
  const s = calcularScore(
    [
      r({ id: "ventas_netas", moneda: "PYG", tendencia: "sube" }),
      r({ id: "ventas_netas", moneda: "USD", tendencia: "baja" }),
    ],
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(s.moneda, "PYG");
  assert.equal(s.puntaje, 100);
});

test("la confianza del score sale de los indicadores que efectivamente puntuaron", () => {
  const s = calcularScore(
    [
      r({ id: "ventas_netas", tendencia: "sube", confianza: { nivel: 0.5, motivos: ["mitad sin costo"] } }),
      // Este no puntúa (desconocida), así que su confianza no debe promediar.
      r({ id: "margen_bruto", tendencia: "desconocida", confianza: { nivel: 1, motivos: [] } }),
    ],
    SIN_UMBRALES,
    "PYG",
  );
  assert.equal(s.confianza, 0.5);
});

test("cada componente que entró al puntaje vuelve con su nombre y su detalle: es auditable", () => {
  const s = calcularScore([r({ id: "ventas_netas", nombre: "Ventas netas", tendencia: "sube" })], SIN_UMBRALES, "PYG");
  const comp = s.dimensiones.find((d) => d.id === "crecimiento")?.componentes[0];
  assert.equal(comp?.nombre, "Ventas netas");
  assert.ok(comp?.detalle.length > 10);
});

test("la metodología viaja con el número, para que dos scores sean comparables", () => {
  const s = calcularScore([r({ id: "ventas_netas", tendencia: "sube" })], SIN_UMBRALES, "PYG");
  assert.equal(s.metodologia, METODOLOGIA);
});

test("explicarCambio dice qué dimensión movió el score, de mayor a menor", () => {
  const antes = calcularScore(
    [r({ id: "ventas_netas", tendencia: "sube" }), r({ id: "margen_bruto", tendencia: "sube" })],
    SIN_UMBRALES,
    "PYG",
  );
  const ahora = calcularScore(
    [r({ id: "ventas_netas", tendencia: "baja" }), r({ id: "margen_bruto", tendencia: "sube" })],
    SIN_UMBRALES,
    "PYG",
  );

  const cambios = explicarCambio(ahora, antes);
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].dimension, "Crecimiento");
  assert.equal(cambios[0].cambio, -80);
});

test("una dimensión que pasó a no poder calcularse no se reporta como caída a cero", () => {
  const antes = calcularScore([r({ id: "ventas_netas", tendencia: "sube" })], SIN_UMBRALES, "PYG");
  const ahora = calcularScore([r({ id: "ventas_netas", tendencia: "desconocida" })], SIN_UMBRALES, "PYG");
  assert.deepEqual(explicarCambio(ahora, antes), []);
});
