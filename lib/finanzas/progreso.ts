import { hoyEnParaguay, sumarDias } from "../fecha.ts";

/**
 * "Cómo venís": cuántas acciones completadas hubo cada día, en los últimos
 * 14 días, en hora de Paraguay.
 *
 * Mismo criterio que ya usa `eos_analitica_usuario_v172.dias_activos`: el día
 * de una acción es el de su `created_at` convertido a America/Asuncion, no el
 * de UTC — una acción de las 21:30 de Asunción no puede contarse mañana.
 *
 * Los días sin ninguna acción entran en la lista con `cantidad: 0`: un día
 * sin barra visible se lee como "no hay datos", no como "cero actividad". La
 * maqueta aprobada (09/10/2026) los muestra igual, con la barra más baja.
 */

export type DiaProgreso = {
  /** `YYYY-MM-DD` en hora de Paraguay. */
  fecha: string;
  cantidad: number;
  /** El último día de la ventana (hoy) se resalta distinto en el gráfico. */
  esHoy: boolean;
};

export function diasDeProgreso(
  fechasCreacion: string[],
  hoyISO: string,
  dias = 14,
): DiaProgreso[] {
  const porDia = new Map<string, number>();
  for (const f of fechasCreacion) {
    const fecha = hoyEnParaguay(new Date(f));
    porDia.set(fecha, (porDia.get(fecha) ?? 0) + 1);
  }

  const desde = sumarDias(hoyISO, -(dias - 1));
  const resultado: DiaProgreso[] = [];
  for (let i = 0; i < dias; i += 1) {
    const fecha = sumarDias(desde, i);
    resultado.push({ fecha, cantidad: porDia.get(fecha) ?? 0, esHoy: fecha === hoyISO });
  }
  return resultado;
}
