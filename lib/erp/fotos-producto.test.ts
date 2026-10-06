import assert from "node:assert/strict";
import test from "node:test";

import { categoriaLimpia, rutaDeFotoEsDe, rutaDeFotoProducto, tipoDeFotoProducto } from "./fotos-producto.ts";

const EMPRESA = "11111111-2222-3333-4444-555555555555";
const PRODUCTO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("la ruta que se arma es la que después se acepta", () => {
  const ruta = rutaDeFotoProducto(EMPRESA, PRODUCTO, "abc123", "image/webp");
  assert.equal(ruta, `${EMPRESA}/${PRODUCTO}-abc123.webp`);
  assert.equal(rutaDeFotoEsDe(EMPRESA, ruta), true);
});

test("una ruta de otra empresa o con otra forma no se acepta", () => {
  const ruta = rutaDeFotoProducto(EMPRESA, PRODUCTO, "abc123", "image/png");
  assert.equal(rutaDeFotoEsDe("99999999-2222-3333-4444-555555555555", ruta), false);
  assert.equal(rutaDeFotoEsDe(EMPRESA, `${EMPRESA}/../otra/${PRODUCTO}-a.png`), false);
  assert.equal(rutaDeFotoEsDe(EMPRESA, `${EMPRESA}/foto.gif`), false);
  assert.equal(rutaDeFotoEsDe(EMPRESA, null), false);
});

test("solo jpg, png y webp", () => {
  assert.equal(tipoDeFotoProducto("IMAGE/JPEG"), "image/jpeg");
  assert.equal(tipoDeFotoProducto("image/gif"), null);
  assert.equal(tipoDeFotoProducto("application/pdf"), null);
  assert.equal(tipoDeFotoProducto(undefined), null);
});

test("la categoría vacía es sin categoría y se recortan los espacios", () => {
  assert.equal(categoriaLimpia("   "), null);
  assert.equal(categoriaLimpia("  Ropa   de  verano "), "Ropa de verano");
  assert.equal(categoriaLimpia(42), null);
  assert.equal(categoriaLimpia("x".repeat(80))?.length, 60);
});
