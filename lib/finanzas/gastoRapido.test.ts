import assert from "node:assert/strict";
import { test } from "node:test";

import { confirmar, interpretar, leerFecha, leerMonto } from "./gastoRapido.ts";

const HOY = "2026-08-25";

/* ==================== MONTOS COMO LOS ESCRIBE LA GENTE ==================== */

test("entiende 'mil'", () => {
  assert.equal(leerMonto("gasté 50 mil en nafta")?.monto, 50_000);
});

test("entiende 'millones' con decimal", () => {
  assert.equal(leerMonto("cobré 1,5 millones")?.monto, 1_500_000);
});

test("entiende 'un millón' escrito con número", () => {
  assert.equal(leerMonto("2 millones")?.monto, 2_000_000);
});

test("entiende 'lucas'", () => {
  assert.equal(leerMonto("300 lucas")?.monto, 300_000);
});

test("entiende la k", () => {
  assert.equal(leerMonto("50k de super")?.monto, 50_000);
});

test("sigue entendiendo el formato de siempre", () => {
  assert.equal(leerMonto("1.500.000")?.monto, 1_500_000);
});

test("detecta dólares", () => {
  const m = leerMonto("pagué 200 usd de hosting");
  assert.equal(m?.monto, 200);
  assert.equal(m?.moneda, "USD");
});

test("sin número no inventa un monto", () => {
  // Guardrail 3: mejor decir "no te entendí" que guardar algo inventado.
  assert.equal(leerMonto("gasté bastante en el super"), null);
  assert.equal(interpretar("gasté bastante", HOY), null);
});

/* ==================== DIRECCIÓN ==================== */

test("'gasté' es plata que sale", () => {
  const g = interpretar("gasté 50 mil en nafta", HOY)!;
  assert.equal(g.tipo, "gasto");
  assert.equal(g.monto, 50_000);
});

test("'cobré' es plata que entra", () => {
  const g = interpretar("cobré 1.200.000 de Juan", HOY)!;
  assert.equal(g.tipo, "ingreso");
  assert.equal(g.monto, 1_200_000);
});

test("'me pagaron' también es plata que entra", () => {
  assert.equal(interpretar("me pagaron 800 mil", HOY)?.tipo, "ingreso");
});

test("sin verbo asume gasto, pero con menos confianza", () => {
  const conVerbo = interpretar("gasté 50 mil en nafta", HOY)!;
  const sinVerbo = interpretar("50 mil nafta", HOY)!;

  assert.equal(sinVerbo.tipo, "gasto");
  assert.ok(sinVerbo.confianza < conVerbo.confianza);
});

/* ==================== DESCRIPCIÓN Y FECHA ==================== */

test("la descripción queda limpia de verbo, monto y relleno", () => {
  assert.equal(interpretar("gasté 50 mil en nafta", HOY)?.descripcion, "nafta");
  assert.equal(interpretar("pagué 120 mil de luz", HOY)?.descripcion, "luz");
});

test("sin descripción usable no queda vacía", () => {
  assert.equal(interpretar("gasté 50 mil", HOY)?.descripcion, "Efectivo");
});

test("'ayer' corre la fecha un día", () => {
  assert.equal(leerFecha("gasté 50 mil ayer", HOY), "2026-08-24");
  assert.equal(leerFecha("anteayer puse 100 mil", HOY), "2026-08-23");
});

test("'ayer' no queda pegado en la descripción", () => {
  const g = interpretar("ayer gasté 50 mil en nafta", HOY)!;
  assert.equal(g.descripcion, "nafta");
  assert.equal(g.fecha, "2026-08-24");
});

/* ==================== LA DEVOLUCIÓN ==================== */

test("le devuelve al usuario lo que entendió", () => {
  // Como esto se guarda sin pedir confirmación —para que cueste una línea—,
  // la única defensa contra un error de lectura es que el usuario lo VEA.
  const g = interpretar("gasté 50 mil en nafta", HOY)!;
  assert.equal(confirmar(g), "Salió ₲ 50.000 — nafta");
});

test("la devolución distingue lo que entra", () => {
  const g = interpretar("cobré 1,5 millones de Marta", HOY)!;
  assert.equal(confirmar(g), "Entró ₲ 1.500.000 — Marta");
});

test("un texto larguísimo se rechaza en vez de recortarse", () => {
  // Esta vía es para una línea. Un párrafo entero es otra cosa y adivinar
  // cuál es el gasto adentro sería inventar.
  assert.equal(interpretar("a".repeat(250), HOY), null);
});
