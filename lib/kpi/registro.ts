import { DEFINICIONES_CRM } from "./definiciones/crm.ts";
import { DEFINICIONES_INVENTARIO } from "./definiciones/inventario.ts";
import { DEFINICIONES_VENTAS } from "./definiciones/ventas.ts";
import type { DefinicionKPI, Familia } from "./tipos.ts";

/**
 * El catálogo completo. Agregar un indicador nuevo es agregar su definición a
 * la familia que le toca y sumarla acá — ninguna ruta ni componente cambia.
 */
export const CATALOGO: DefinicionKPI[] = [
  ...DEFINICIONES_VENTAS,
  ...DEFINICIONES_CRM,
  ...DEFINICIONES_INVENTARIO,
];

const POR_ID = new Map(CATALOGO.map((def) => [def.id, def]));

export function definicion(id: string): DefinicionKPI | undefined {
  return POR_ID.get(id);
}

export function definicionesDe(familia: Familia): DefinicionKPI[] {
  return CATALOGO.filter((def) => def.familia === familia);
}

/** Resuelve una lista de ids pedidos, ignorando los que no existen en el catálogo. */
export function resolver(ids: string[]): DefinicionKPI[] {
  return ids.map((id) => POR_ID.get(id)).filter((def): def is DefinicionKPI => def !== undefined);
}
