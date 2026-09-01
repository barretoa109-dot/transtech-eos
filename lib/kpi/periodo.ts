import type { Periodo } from "./tipos.ts";
export type { Periodo };

/**
 * Aritmética de períodos, compartida por el motor de KPIs y por
 * `lib/erp/indicadores.ts` (que la tenía antes, acá solo se mudó).
 *
 * Fechas como texto ISO (`YYYY-MM-DD`), nunca `Date` de por medio salvo para
 * sumar o restar días — `Date` local corre el día según la zona horaria de
 * quien ejecuta, y acá siempre se ancla a UTC a propósito.
 */

export function dias(desde: string, hasta: string): number {
  return (
    Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1
  );
}

export function correr(fecha: string, cantidadDias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + cantidadDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** El período anterior, del mismo largo y pegado al que se pide. */
export function periodoAnterior(periodo: Periodo): Periodo {
  const largo = dias(periodo.desde, periodo.hasta);

  return {
    desde: correr(periodo.desde, -largo),
    hasta: correr(periodo.desde, -1),
  };
}

export function dentroDe(fecha: string, p: Periodo): boolean {
  return fecha >= p.desde && fecha <= p.hasta;
}
