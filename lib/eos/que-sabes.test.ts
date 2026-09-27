import assert from "node:assert/strict";
import { test } from "node:test";

import {
  esPreguntaQueSabes,
  mejorDiaDeLaSemana,
  MIN_VENTAS_PARA_PATRON,
  redactarLoQueSe,
  type LoQueSe,
} from "./que-sabes.ts";

test("reconoce la pregunta dicha de varias formas", () => {
  for (const m of [
    "¿Qué sabés de mi negocio?",
    "que sabes de mi negocio",
    "Qué sabés sobre mi empresa?",
    "EOS, qué sabés de mi negocio?",
    "y qué conocés de mi emprendimiento",
    "¿Qué sabés de mi negocio hasta ahora?",
    "que tenes de mi local",
  ]) {
    assert.ok(esPreguntaQueSabes(m), m);
  }
});

test("no se roba mensajes que son otra cosa", () => {
  for (const m of [
    "qué sabés de mi competencia?",
    "que sabes de marketing para mi negocio",
    "¿qué sabés de mi negocio de tortas que vendo por Instagram y quiero crecer?",
    "vendí 3 bolsas de balanceado",
    "qué sabés hacer?",
    "",
  ]) {
    assert.ok(!esPreguntaQueSabes(m), m);
  }
});

test("el mejor día solo se afirma con suficientes ventas y sin empate", () => {
  // 2026-09-25 es viernes.
  const viernes = Array(6).fill("2026-09-25");
  const lunes = Array(4).fill("2026-09-21");
  assert.equal(mejorDiaDeLaSemana([...viernes, ...lunes]), 5);

  assert.equal(mejorDiaDeLaSemana(Array(MIN_VENTAS_PARA_PATRON - 1).fill("2026-09-25")), null);
  assert.equal(mejorDiaDeLaSemana([...Array(5).fill("2026-09-25"), ...Array(5).fill("2026-09-21")]), null);
});

const VACIO: LoQueSe = {
  productos: 0,
  productosConCosto: 0,
  clientes: 0,
  proveedores: 0,
  ventas30: { cantidad: 0, total: 0 },
  mejorDia: null,
  porCobrar: { clientes: 0, total: 0 },
};

test("con una cuenta vacía dice cómo enseñarle, sin inventar nada", () => {
  const texto = redactarLoQueSe(VACIO);
  assert.ok(texto.startsWith("Todavía no sé casi nada de tu negocio"));
  assert.ok(texto.includes("foto de tu lista de precios"));
});

test("con datos dice los números exactos y pide lo que más falta", () => {
  const texto = redactarLoQueSe({
    productos: 43,
    productosConCosto: 30,
    clientes: 12,
    proveedores: 3,
    ventas30: { cantidad: 25, total: 7_187_500 },
    mejorDia: 5,
    porCobrar: { clientes: 2, total: 1_500_000 },
  });

  assert.equal(
    texto,
    [
      "Esto es lo que sé de tu negocio:",
      "• Tu catálogo: 43 productos (30 con su costo).",
      "• Conozco a 12 clientes y 3 proveedores.",
      "• En los últimos 30 días hiciste 25 ventas, por ₲ 7.187.500.",
      "• El día que más vendés es el viernes.",
      '• Te deben ₲ 1.500.000 entre 2 clientes. Si me preguntás "¿quién me debe?", te paso la lista.',
      "Lo que más me ayudaría ahora: el costo de 13 productos que todavía no tengo. Con eso te digo cuánto ganás en cada venta.",
    ].join("\n"),
  );
});

test("una línea sin dato no aparece, y con todos los costos no se piden", () => {
  const texto = redactarLoQueSe({ ...VACIO, productos: 1, productosConCosto: 1 });
  assert.equal(
    texto,
    [
      "Esto es lo que sé de tu negocio:",
      "• Tu catálogo: 1 producto, con su costo.",
      "Cuanto más me contás, mejor te aviso antes de que algo se complique.",
    ].join("\n"),
  );
});
