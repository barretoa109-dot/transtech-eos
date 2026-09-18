/**
 * Qué documentos cuentan en los resúmenes de Negocio.
 *
 * Anular una venta o una compra borra su movimiento de caja, así que el
 * documento anulado queda con `movimiento_id` en null: igual que uno que
 * todavía no se pagó. Un resumen que solo mira `movimiento_id` lo cuenta como
 * deuda y nunca se va, aunque el documento esté tachado en la lista.
 *
 * Es la misma regla que ya usa la base para el "por cobrar" y el "por pagar"
 * que ve el chat: fuera lo anulado y lo ya saldado.
 */

type Documento = {
  estado: string;
  movimiento_id: string | null;
};

const SALDADOS = new Set(["anulada", "pagada", "cobrada"]);

/** Lo que sigue vivo: todo menos lo anulado. */
export function vigentes<T extends Pick<Documento, "estado">>(documentos: T[]): T[] {
  return documentos.filter((d) => d.estado !== "anulada");
}

/** Lo que todavía hay que cobrar o pagar. */
export function pendientes<T extends Documento>(documentos: T[]): T[] {
  return documentos.filter((d) => !SALDADOS.has(d.estado) && !d.movimiento_id);
}
