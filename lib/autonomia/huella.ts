import { createHash } from "node:crypto";

/**
 * La huella de un comando. Es lo único que impide que una venta se cargue dos
 * veces.
 *
 * ============================================================
 * POR QUÉ VIVE ACÁ Y NO EN EL HANDLER
 * ============================================================
 *
 * Estaba adentro de `lib/worker-gate-handler.ts`, que importa `next/server`.
 * Eso hace que ninguna prueba de `lib/` pueda importarlo — y esta es,
 * probablemente, la función más peligrosa del sistema para dejar sin prueba.
 *
 * Es el mismo motivo por el que `SYSTEM_RISK` se mudó a `riesgo.ts` el 9 de
 * septiembre de 2026.
 *
 * ============================================================
 * QUÉ GARANTIZA, Y QUÉ PASA SI FALLA
 * ============================================================
 *
 * El Worker Gate guarda esta huella por comando. Cuando llega un reintento
 * —una red que se cortó, un worker que reintentó, la persona que tocó dos
 * veces— la huella coincide y el comando NO se vuelve a ejecutar.
 *
 * Si la huella de un mismo pedido cambiara entre dos llamadas, el gate vería
 * dos comandos distintos: la venta se registraría dos veces, el stock se
 * descontaría dos veces y el ingreso aparecería dos veces en el panel.
 *
 * Si dos pedidos DISTINTOS dieran la misma huella, pasaría lo contrario: el
 * segundo se descartaría en silencio y la persona creería que quedó cargado.
 *
 * Las dos fallas son caras y ninguna hace ruido.
 *
 * ============================================================
 * EL ORDEN DE LAS CLAVES NO PUEDE IMPORTAR
 * ============================================================
 *
 * OpenAI no garantiza en qué orden devuelve las claves de un objeto JSON, y
 * `JSON.stringify` las escribe en el orden en que están. Sin ordenarlas, el
 * mismo pedido con las claves al revés da otra huella — y ahí se pierde la
 * garantía de una sola ejecución justo en el caso en que más falta hace, que
 * es el reintento.
 *
 * Por eso `estable` ordena recursivamente. Los ARREGLOS no se ordenan: en
 * ellos el orden sí es información —tres ítems de una venta no son el mismo
 * pedido en otro orden— y ordenarlos haría que dos ventas distintas se vieran
 * iguales.
 */
export function estable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(estable);
  if (!value || typeof value !== "object") return value;

  /*
   * Lo que sabe convertirse a JSON, se convierte acá.
   *
   * Una fecha es un objeto sin claves propias, así que el `reduce` de abajo la
   * dejaba en `{}` — y dos fechas distintas daban la MISMA huella. El comando
   * que llegara segundo se descartaría en silencio por "repetido".
   *
   * Hoy no puede pasar: el payload del gate viene de `JSON.parse`, que nunca
   * produce un Date, y `lib/gateway/jobs.ts` excluye a propósito todo
   * timestamp de inferencia. Pero `estable` es una función exportada y esto
   * cuesta dos líneas.
   *
   * Delegar en `toJSON` además la deja consistente con el `JSON.stringify` que
   * viene justo después: las dos ven lo mismo.
   */
  const conJSON = value as { toJSON?: () => unknown };
  if (typeof conJSON.toJSON === "function") return conJSON.toJSON();

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = estable((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

/** sha256 del payload canonicalizado. Ver el encabezado. */
export function huella(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(estable(value))).digest("hex");
}
