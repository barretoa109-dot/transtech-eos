import { DEFINICIONES_CARTERA } from "./definiciones/cartera.ts";
import { DEFINICIONES_COMPRAS } from "./definiciones/compras.ts";
import { DEFINICIONES_CRM } from "./definiciones/crm.ts";
import { DEFINICIONES_FINANZAS } from "./definiciones/finanzas.ts";
import { DEFINICIONES_INVENTARIO } from "./definiciones/inventario.ts";
import { DEFINICIONES_VENTAS } from "./definiciones/ventas.ts";
import type { DefinicionKPI, Familia } from "./tipos.ts";

/**
 * El catálogo completo. Agregar un indicador nuevo es agregar su definición a
 * la familia que le toca y sumarla acá — ninguna ruta ni componente cambia.
 */
export const CATALOGO: DefinicionKPI[] = [
  ...DEFINICIONES_VENTAS,
  ...DEFINICIONES_FINANZAS,
  ...DEFINICIONES_CRM,
  ...DEFINICIONES_INVENTARIO,
  ...DEFINICIONES_CARTERA,
  ...DEFINICIONES_COMPRAS,
];

const POR_ID = new Map(CATALOGO.map((def) => [def.id, def]));

export function definicion(id: string): DefinicionKPI | undefined {
  return POR_ID.get(id);
}

export function definicionesDe(familia: Familia): DefinicionKPI[] {
  return CATALOGO.filter((def) => def.familia === familia);
}

/**
 * Los ids que declaran umbral.
 *
 * Lo necesita el Business Score, que puntúa distinto a un indicador con umbral
 * declarado que a uno sin él. Se calcula desde el catálogo —única fuente— en
 * vez de mantener una segunda lista que podría quedar vieja.
 */
export const CON_UMBRALES: Set<string> = new Set(
  CATALOGO.filter((def) => def.umbrales !== undefined).map((def) => def.id),
);

/** Resuelve una lista de ids pedidos, ignorando los que no existen en el catálogo. */
export function resolver(ids: string[]): DefinicionKPI[] {
  return ids.map((id) => POR_ID.get(id)).filter((def): def is DefinicionKPI => def !== undefined);
}
