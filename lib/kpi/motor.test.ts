import assert from "node:assert/strict";
import test from "node:test";
import { calcular, insumosFaltantes } from "./motor.ts";
import { valorConocido, valorDesconocido } from "./tipos.ts";
import type { DefinicionKPI, Hechos, VentaHecho } from "./tipos.ts";

function venta(p: Partial<VentaHecho> = {}): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? "2026-08-15",
    moneda: p.moneda ?? "PYG",
    contacto_id: p.contacto_id ?? null,
    contacto_nombre: p.contacto_nombre ?? null,
    items: p.items ?? [],
  };
}

/** Cuántas ventas hay EN EL PERÍODO, por moneda. Sirve para probar tendencia. */
const CANTIDAD_VENTAS: DefinicionKPI = {
  id: "cantidad_ventas",
  nombre: "Cantidad de ventas",
  familia: "ventas",
  unidad: "cantidad",
  direccion: "mas_es_mejor",
  necesita: ["ventas"],
  calcular(hechos, periodo) {
    const ventas = (hechos.ventas ?? []).filter(
      (v) => v.fecha >= periodo.desde && v.fecha <= periodo.hasta,
    );
    const monedas = new Set(ventas.map((v) => v.moneda ?? "PYG"));
    return [...monedas].map((moneda) =>
      valorConocido(moneda, ventas.filter((v) => (v.moneda ?? "PYG") === moneda).length),
    );
  },
};

/** Ignora el período: sirve para probar SOLO el cálculo de estado, sin ruido de tendencia. */
function nivelFijo(direccion: DefinicionKPI["direccion"], umbrales?: DefinicionKPI["umbrales"]): DefinicionKPI {
  return {
    id: "nivel",
    nombre: "Nivel",
    familia: "ventas",
    unidad: "cantidad",
    direccion,
    necesita: ["ventas"],
    umbrales,
    calcular: (hechos: Hechos) => [valorConocido("PYG", (hechos.ventas ?? []).length)],
  };
}

const SIEMPRE_DESCONOCIDO: DefinicionKPI = {
  id: "siempre_desconocido",
  nombre: "Nunca se puede calcular",
  familia: "ventas",
  unidad: "cantidad",
  direccion: "neutro",
  necesita: ["ventas"],
  calcular: () => [valorDesconocido("PYG", "no hay dato suficiente")],
};

test("calcula el valor actual y lo compara contra el período anterior", () => {
  const hechos: Hechos = {
    ventas: [
      venta({ fecha: "2026-07-10" }), // período anterior
      venta({ fecha: "2026-08-05" }),
      venta({ fecha: "2026-08-20" }),
    ],
  };

  const [r] = calcular([CANTIDAD_VENTAS], hechos, { desde: "2026-08-01", hasta: "2026-08-31" });

  assert.equal(r.valor, 2);
  assert.equal(r.anterior, 1);
  assert.equal(r.variacion, 1);
  assert.equal(r.variacion_pct, 100);
  assert.equal(r.tendencia, "sube");
});

test("sin dato en el período anterior, la tendencia es desconocida y no se inventa variación", () => {
  const hechos: Hechos = { ventas: [venta({ fecha: "2026-08-05" })] };
  const [r] = calcular([CANTIDAD_VENTAS], hechos, { desde: "2026-08-01", hasta: "2026-08-31" });

  assert.equal(r.valor, 1);
  assert.equal(r.anterior, null);
  assert.equal(r.variacion, null);
  assert.equal(r.variacion_pct, null);
  assert.equal(r.tendencia, "desconocida");
});

test("caer a la mitad se informa como baja, con la variación negativa", () => {
  const hechos: Hechos = {
    ventas: [
      venta({ fecha: "2026-07-05" }),
      venta({ fecha: "2026-07-10" }),
      venta({ fecha: "2026-08-05" }),
    ],
  };
  const [r] = calcular([CANTIDAD_VENTAS], hechos, { desde: "2026-08-01", hasta: "2026-08-31" });

  assert.equal(r.valor, 1);
  assert.equal(r.anterior, 2);
  assert.equal(r.variacion, -1);
  assert.equal(r.variacion_pct, -50);
  assert.equal(r.tendencia, "baja");
});

test("una definición sin su insumo no aparece en el resultado: no se llama a calcular a ciegas", () => {
  const resultados = calcular([CANTIDAD_VENTAS], {}, { desde: "2026-08-01", hasta: "2026-08-31" });
  assert.deepEqual(resultados, []);
});

test("insumosFaltantes dice qué le falta a cada definición que no se pudo calcular", () => {
  const faltan = insumosFaltantes([CANTIDAD_VENTAS], {});
  assert.equal(faltan.length, 1);
  assert.equal(faltan[0].id, "cantidad_ventas");
  assert.deepEqual(faltan[0].falta, ["ventas"]);
});

test("insumosFaltantes no lista lo que sí se pudo calcular", () => {
  assert.deepEqual(insumosFaltantes([CANTIDAD_VENTAS], { ventas: [] }), []);
});

test("una foto del momento no se compara contra el período anterior", () => {
  const FOTO: DefinicionKPI = {
    id: "foto",
    nombre: "Stock bajo mínimo ahora",
    familia: "inventario",
    unidad: "cantidad",
    direccion: "menos_es_mejor",
    necesita: ["ventas"],
    instantanea: true,
    // Ignora el período a propósito: es una foto de "ahora", no una suma.
    calcular: (hechos: Hechos) => [valorConocido("PYG", (hechos.ventas ?? []).length)],
  };

  const periodo = { desde: "2026-08-01", hasta: "2026-08-31" };
  const [r] = calcular([FOTO], { ventas: [venta(), venta()] }, periodo);

  assert.equal(r.valor, 2);
  assert.equal(r.anterior, null);
  assert.equal(r.variacion, null);
  assert.equal(r.variacion_pct, null);
  assert.equal(r.tendencia, "desconocida");
});

test("un valor null da estado sin_datos, y viaja con su confianza y su motivo", () => {
  const periodo = { desde: "2026-08-01", hasta: "2026-08-31" };
  const [r] = calcular([SIEMPRE_DESCONOCIDO], { ventas: [venta()] }, periodo);

  assert.equal(r.valor, null);
  assert.equal(r.estado, "sin_datos");
  assert.equal(r.falta, "no hay dato suficiente");
  assert.equal(r.confianza.nivel, 0);
});

test("mas_es_mejor: bajo el umbral de alerta es alerta, entre alerta y atención es atención", () => {
  const periodo = { desde: "2026-08-01", hasta: "2026-08-31" };
  const def = nivelFijo("mas_es_mejor", { atencion: 5, alerta: 2 });

  const conUna = calcular([def], { ventas: [venta()] }, periodo)[0];
  assert.equal(conUna.valor, 1);
  assert.equal(conUna.estado, "alerta");

  const conDos = calcular([def], { ventas: [venta(), venta()] }, periodo)[0];
  assert.equal(conDos.valor, 2);
  assert.equal(conDos.estado, "atencion");

  const conCinco = calcular(
    [def],
    { ventas: [venta(), venta(), venta(), venta(), venta()] },
    periodo,
  )[0];
  assert.equal(conCinco.valor, 5);
  assert.equal(conCinco.estado, "bien");
});

test("menos_es_mejor invierte el sentido: un valor alto es lo que preocupa", () => {
  const periodo = { desde: "2026-08-01", hasta: "2026-08-31" };
  const def = nivelFijo("menos_es_mejor", { atencion: 5, alerta: 10 });

  const bien = calcular([def], { ventas: Array.from({ length: 3 }, () => venta()) }, periodo)[0];
  assert.equal(bien.estado, "bien");

  const atencion = calcular([def], { ventas: Array.from({ length: 7 }, () => venta()) }, periodo)[0];
  assert.equal(atencion.estado, "atencion");

  const alerta = calcular([def], { ventas: Array.from({ length: 12 }, () => venta()) }, periodo)[0];
  assert.equal(alerta.estado, "alerta");
});

test("sin umbrales, un valor conocido siempre da estado bien: no se alarma por su cuenta", () => {
  const periodo = { desde: "2026-08-01", hasta: "2026-08-31" };
  const def = nivelFijo("neutro");
  const [r] = calcular([def], { ventas: [venta()] }, periodo);
  assert.equal(r.estado, "bien");
});
