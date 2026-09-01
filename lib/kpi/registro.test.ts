import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGO, definicion, definicionesDe, resolver } from "./registro.ts";

test("ningún id se repite en todo el catálogo", () => {
  const ids = CATALOGO.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("el catálogo no está vacío", () => {
  assert.ok(CATALOGO.length >= 15);
});

test("definicion encuentra por id, y no explota con un id inexistente", () => {
  assert.equal(definicion("margen_bruto")?.nombre, "Margen bruto");
  assert.equal(definicion("no-existe"), undefined);
});

test("definicionesDe filtra por familia", () => {
  const crm = definicionesDe("crm");
  assert.ok(crm.length > 0);
  for (const def of crm) assert.equal(def.familia, "crm");
});

test("resolver ignora los ids que no existen, sin lanzar", () => {
  const encontrados = resolver(["margen_bruto", "no-existe", "roi"]);
  assert.deepEqual(
    encontrados.map((d) => d.id),
    ["margen_bruto", "roi"],
  );
});

test("resolver con una lista vacía devuelve una lista vacía", () => {
  assert.deepEqual(resolver([]), []);
});
