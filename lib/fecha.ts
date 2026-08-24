/**
 * Fechas en la zona del usuario, no en la del servidor.
 *
 * Este proyecto ya arrastró CUATRO veces el mismo error: usar
 * `new Date().toISOString().slice(0, 10)` donde correspondía la fecha de
 * Paraguay. A las 21:00 de Asunción, UTC ya está en el día siguiente, así que
 * un movimiento confirmado de noche quedaba fechado mañana y el briefing salía
 * con el resumen del día equivocado.
 *
 * Existía como función suelta copiada en cuatro archivos. Cada copia era una
 * oportunidad más de que alguien escribiera la versión en UTC.
 */

export const ZONA_PARAGUAY = "America/Asuncion";

/**
 * Hoy en Paraguay, como `YYYY-MM-DD`.
 *
 * Usa el locale `en-CA` porque es el que formatea ISO sin tener que armar el
 * string a mano a partir de las partes.
 */
export function hoyEnParaguay(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_PARAGUAY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** La misma fecha corrida `dias` días, sin que la zona horaria se meta. */
export function sumarDias(iso: string, dias: number): string {
  const base = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
}
