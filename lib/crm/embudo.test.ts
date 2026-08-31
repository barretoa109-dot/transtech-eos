import assert from "node:assert/strict";
import { test } from "node:test";

import {
  esEtapa,
  etiquetaDeEtapa,
  embudoPorMoneda,
  porEtapa,
  probabilidadDe,
  siguienteEtapa,
  valorPonderado,
} from "./embudo.ts";

test("una etapa inventada no pasa", () => {
  assert.equal(esEtapa("negociacion"), true);
  assert.equal(esEtapa("casi_ganada"), false);
  assert.equal(esEtapa(null), false);
});

test("el valor ponderado no es la suma del embudo", () => {
  // "Hay cien millones en juego" es cierto y no significa nada. Un embudo que
  // se lee como caja futura hace gastar plata que todavía no existe.
  const ponderado = valorPonderado([
    { monto: 10_000_000, etapa: "nueva" }, // 10%
    { monto: 10_000_000, etapa: "negociacion" }, // 75%
  ]);

  assert.equal(ponderado, 8_500_000);
});

test("lo ganado y lo perdido no cuentan como esperado", () => {
  // Lo ganado ya entró —o va a entrar por la venta, no por el embudo— y lo
  // perdido no entra nunca. Contarlos infla la expectativa las dos veces.
  const ponderado = valorPonderado([
    { monto: 5_000_000, etapa: "ganada" },
    { monto: 5_000_000, etapa: "perdida" },
    { monto: 1_000_000, etapa: "propuesta" },
  ]);

  assert.equal(ponderado, 500_000);
});

test("la probabilidad crece con la etapa", () => {
  const orden = ["nueva", "contactado", "propuesta", "negociacion"];

  for (let i = 1; i < orden.length; i += 1) {
    assert.ok(
      probabilidadDe(orden[i]) > probabilidadDe(orden[i - 1]),
      `${orden[i]} debería ser más probable que ${orden[i - 1]}`,
    );
  }
});

test("la etapa siguiente es la del camino normal, y no pasa de ganada", () => {
  assert.equal(siguienteEtapa("nueva"), "contactado");
  assert.equal(siguienteEtapa("negociacion"), "ganada");
  assert.equal(siguienteEtapa("ganada"), "ganada");
  // Una perdida que se reabre vuelve al camino, no salta al final.
  assert.equal(siguienteEtapa("perdida"), "ganada");
});

test("el conteo por etapa trae todas, incluso las vacías", () => {
  // Una etapa vacía es información: "no hay nada en propuesta" explica por qué
  // el mes que viene va a estar flojo.
  const conteo = porEtapa([{ monto: 100, etapa: "nueva" }]);

  assert.equal(conteo.length, 6);
  assert.equal(conteo[0].cantidad, 1);
  assert.equal(conteo[1].cantidad, 0);
});

test("las etiquetas se muestran en castellano", () => {
  assert.equal(etiquetaDeEtapa("negociacion"), "Negociación");
  assert.equal(etiquetaDeEtapa("lo_que_sea"), "lo_que_sea");
});

// ============================================================
// El embudo no puede sumar guaraníes con dólares
// ============================================================

test("cada moneda tiene su propio embudo, sin mezclarse", () => {
  const resultado = embudoPorMoneda([
    { monto: 5_000_000, etapa: "propuesta", moneda: "PYG" },
    { monto: 10_000, etapa: "propuesta", moneda: "USD" },
    { monto: 2_000_000, etapa: "ganada", moneda: "PYG" },
  ]);

  assert.equal(resultado.length, 2);

  const pyg = resultado.find((r) => r.moneda === "PYG")!;
  const usd = resultado.find((r) => r.moneda === "USD")!;

  assert.equal(pyg.en_juego, 5_000_000);
  assert.equal(pyg.ganado, 2_000_000);
  assert.equal(usd.en_juego, 10_000);
  assert.equal(usd.ganado, 0);

  // Lo que importa: en ningún lado aparece 5.010.000.
  for (const fila of resultado) {
    assert.notEqual(fila.en_juego, 5_010_000);
  }
});

test("la moneda del negocio va siempre primero", () => {
  const mezcla = [
    { monto: 1, etapa: "nueva", moneda: "USD" },
    { monto: 1, etapa: "nueva", moneda: "BRL" },
    { monto: 1, etapa: "nueva", moneda: "PYG" },
  ];

  assert.equal(embudoPorMoneda(mezcla)[0].moneda, "PYG");
  assert.equal(embudoPorMoneda(mezcla, "USD")[0].moneda, "USD");
});

test("una sola moneda da un solo embudo, como antes", () => {
  const resultado = embudoPorMoneda([
    { monto: 100, etapa: "nueva", moneda: "PYG" },
    { monto: 200, etapa: "ganada", moneda: "PYG" },
  ]);

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].en_juego, 100);
  assert.equal(resultado[0].ganado, 200);
});

test("sin oportunidades no hay ninguna moneda que mostrar", () => {
  assert.deepEqual(embudoPorMoneda([]), []);
});
