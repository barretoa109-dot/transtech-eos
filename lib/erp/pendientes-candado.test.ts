import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Candado del "deuda fantasma".
 *
 * Anular una venta o una compra borra su movimiento de caja, así que el
 * documento anulado queda con `movimiento_id` en null, igual que uno impago.
 * Un resumen que filtra solo por `!x.movimiento_id` cuenta lo anulado como
 * deuda para siempre. Pasó en Compras y en Ventas.
 *
 * La regla vive en `lib/erp/pendientes.ts`. Este test falla si una pantalla
 * vuelve a armar ese filtro a mano en vez de usarla.
 */

const RAIZ = join(process.cwd(), "app");

function archivos(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

// `.filter((c) => !c.movimiento_id)` y variantes con cualquier nombre de variable.
const FILTRO_A_MANO = /\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*!\s*\w+\.movimiento_id\b/;

test("ninguna pantalla cuenta pendientes filtrando solo por movimiento_id", () => {
  const culpables = archivos(RAIZ).filter((ruta) =>
    FILTRO_A_MANO.test(readFileSync(ruta, "utf8")),
  );

  assert.deepEqual(
    culpables,
    [],
    "Usá `pendientes()` de lib/erp/pendientes: un documento anulado no tiene " +
      "movimiento y se contaría como deuda.",
  );
});

test("el candado detecta el patrón que pasó", () => {
  assert.match("compras.filter((c) => !c.movimiento_id)", FILTRO_A_MANO);
  assert.match("ventas.filter(venta => !venta.movimiento_id)", FILTRO_A_MANO);
  assert.doesNotMatch("pendientes(ventas)", FILTRO_A_MANO);
});
