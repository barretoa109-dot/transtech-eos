import assert from "node:assert/strict";
import { test } from "node:test";

import {
  esEtapa,
  etiquetaDeEtapa,
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
