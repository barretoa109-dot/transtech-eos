import assert from "node:assert/strict";
import { test } from "node:test";

import { limpiarVariantes, nombresDeVariantes } from "./variantes.ts";

test("limpiarVariantes separa por coma, recorta y descarta vacíos", () => {
  assert.deepEqual(limpiarVariantes("S, M,  L ,"), ["S", "M", "L"]);
});

test("limpiarVariantes acepta un array ya separado", () => {
  assert.deepEqual(limpiarVariantes(["Rojo", " Azul "]), ["Rojo", "Azul"]);
});

test("limpiarVariantes sin nada da una lista vacía", () => {
  assert.deepEqual(limpiarVariantes(undefined), []);
  assert.deepEqual(limpiarVariantes(""), []);
  assert.deepEqual(limpiarVariantes(null), []);
});

test("limpiarVariantes no repite la misma variante dos veces", () => {
  assert.deepEqual(limpiarVariantes("M, m, M"), ["M", "m"]);
});

test("limpiarVariantes descarta una variante de más de 60 caracteres", () => {
  assert.deepEqual(limpiarVariantes(`S, ${"x".repeat(61)}`), ["S"]);
});

test("nombresDeVariantes arma el nombre completo, como el resolver del chat lo espera", () => {
  assert.deepEqual(nombresDeVariantes("Conjunto verde oliva", "S, M, L"), [
    "Conjunto verde oliva S",
    "Conjunto verde oliva M",
    "Conjunto verde oliva L",
  ]);
});

test("nombresDeVariantes recorta el nombre base antes de combinar", () => {
  assert.deepEqual(nombresDeVariantes("  Remera  ", "Azul"), ["Remera Azul"]);
});

test("nombresDeVariantes corta en 200 caracteres como cualquier nombre de producto", () => {
  const [nombre] = nombresDeVariantes("a".repeat(195), "variante larga");
  assert.equal(nombre.length, 200);
});
