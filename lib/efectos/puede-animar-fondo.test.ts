import assert from "node:assert/strict";
import { test } from "node:test";

import { puedeAnimarFondo, type EntornoNavegador } from "./puede-animar-fondo.ts";

function entorno(cambios: Partial<EntornoNavegador> & { consultas?: string[] } = {}): EntornoNavegador {
  const { consultas = [], ...resto } = cambios;
  return {
    innerWidth: 1440,
    matchMedia: (q) => ({ matches: consultas.includes(q) }),
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    ...resto,
  };
}

test("una computadora normal ve el fondo 3D", () => {
  assert.equal(puedeAnimarFondo(entorno()), true);
});

test("un teléfono no lo carga, por ancho o por pantalla táctil", () => {
  assert.equal(puedeAnimarFondo(entorno({ innerWidth: 390 })), false);
  assert.equal(puedeAnimarFondo(entorno({ consultas: ["(pointer: coarse)"] })), false);
});

test("quien pidió menos movimiento o ahorro de datos, tampoco", () => {
  assert.equal(puedeAnimarFondo(entorno({ consultas: ["(prefers-reduced-motion: reduce)"] })), false);
  assert.equal(puedeAnimarFondo(entorno({ navigator: { hardwareConcurrency: 8, connection: { saveData: true } } })), false);
});

test("un equipo modesto, tampoco", () => {
  assert.equal(puedeAnimarFondo(entorno({ navigator: { hardwareConcurrency: 4, deviceMemory: 8 } })), false);
  assert.equal(puedeAnimarFondo(entorno({ navigator: { hardwareConcurrency: 8, deviceMemory: 2 } })), false);
});

test("si el navegador no informa núcleos ni memoria, se asume que puede", () => {
  assert.equal(puedeAnimarFondo(entorno({ navigator: {} })), true);
});
