import { monedaConocida } from "../finanzas/monedas.ts";

/**
 * De qué moneda es una venta o una compra.
 *
 * ============================================================
 * SALE DE LAS LÍNEAS, NO DEL CATÁLOGO
 * ============================================================
 *
 * La pantalla deducía la moneda del documento del PRIMER producto del catálogo
 * (`productos[0]?.moneda ?? "PYG"`). Alcanza con tener un producto en dólares
 * arriba de la lista para que toda venta en guaraníes se registre como USD, o
 * al revés — y como el total viaja a un movimiento financiero, el número
 * equivocado se propaga al panel.
 *
 * La moneda de un documento es la de lo que hay ADENTRO. Si adentro hay dos,
 * el documento no tiene una moneda: tiene un problema, y hay que decirlo antes
 * de guardarlo, no después.
 *
 * ============================================================
 * ESTO NO REEMPLAZA AL TRIGGER
 * ============================================================
 *
 * La base tiene la misma regla en `eos_erp_item_moneda_coherente` (v93), y ahí
 * es donde de verdad se cumple: la pantalla no es una frontera de seguridad y
 * el chat registra ventas por otro camino. Esto existe para que el usuario vea
 * un mensaje claro mientras carga, en vez de un error de la base después de
 * apretar Registrar.
 */

export type MonedaDocumento =
  | { ok: true; moneda: string }
  | { ok: false; monedas: string[] };

export function monedaDelDocumento(
  monedas: (string | null | undefined)[],
  porDefecto = "PYG",
): MonedaDocumento {
  const distintas = [...new Set(monedas.map((m) => monedaConocida(m, porDefecto)))];

  // Un documento vacío todavía no contradice nada: se muestra en la moneda por
  // defecto hasta que entre la primera línea.
  if (distintas.length === 0) return { ok: true, moneda: porDefecto };
  if (distintas.length === 1) return { ok: true, moneda: distintas[0] };

  return { ok: false, monedas: distintas.sort() };
}

/** El texto que ve el usuario cuando mezcló monedas en un mismo documento. */
export function avisoMonedasMezcladas(monedas: string[]): string {
  return (
    `Este documento mezcla ${monedas.join(" y ")}. ` +
    "Un total no puede estar en dos monedas: separalos en dos documentos, uno por moneda."
  );
}
