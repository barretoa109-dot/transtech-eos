import { sinIva } from "../erp/margen.ts";
import { monedaConocida } from "../finanzas/monedas.ts";
import { dentroDe } from "./periodo.ts";
import type { Hechos, Periodo, VentaHecho } from "./tipos.ts";

/**
 * De dónde salió el cambio.
 *
 * ============================================================
 * ESTO ES EL DRILL-DOWN LEÍDO AL REVÉS
 * ============================================================
 *
 * El drill-down contesta "¿de dónde sale este número?" abriendo un total en
 * sus partes. La causa raíz contesta "¿por qué cambió?" comparando esas
 * mismas partes contra el período anterior y ordenándolas por cuánto
 * aportaron al movimiento. Es la misma descomposición; cambia la pregunta.
 *
 * Por eso no hay un motor de causas aparte: si hubiera dos formas de partir
 * las ventas por producto, un día darían totales distintos y no habría manera
 * de saber cuál creer.
 *
 * ============================================================
 * APORTE NO ES CAUSA
 * ============================================================
 *
 * Que tres productos expliquen el 68% de la caída es un HECHO aritmético: sus
 * ventas bajaron y la suma da eso. Por qué bajaron —subió el costo, se acabó
 * el stock, el cliente se fue a la competencia— EOS no lo sabe.
 *
 * Este módulo devuelve la aritmética y nada más. La redacción que la acompaña
 * dice "explican" y nunca "causaron". La diferencia parece de palabras y no lo
 * es: sobre "causaron" alguien toma una decisión.
 */

export type Dimension = "producto" | "cliente";

export type Aporte = {
  clave: string;
  nombre: string;
  /** Neto de IVA, en el período actual. */
  actual: number;
  anterior: number;
  cambio: number;
  /**
   * Qué proporción del cambio total explica este ítem, de 0 a 1.
   *
   * Puede pasar de 1: si unos suben y otros bajan, el que baja puede explicar
   * el 150% de una caída neta más chica. Es correcto y es informativo —"esto
   * habría sido peor si otros no hubieran compensado"— así que no se recorta.
   */
  proporcion: number;
};

export type Descomposicion = {
  dimension: Dimension;
  moneda: string;
  totalActual: number;
  totalAnterior: number;
  cambio: number;
  /** Ordenados por magnitud del aporte, del más grande al más chico. */
  aportes: Aporte[];
};

/** El neto de IVA de una venta, línea por línea (una venta puede mezclar tasas). */
function netoDe(v: VentaHecho): number {
  return v.items.reduce((s, it) => s + sinIva(it.total, it.iva), 0);
}

function claveYNombre(v: VentaHecho, dimension: Dimension): { clave: string; nombre: string } {
  if (dimension === "cliente") {
    return {
      clave: v.contacto_id ?? "sin-cliente",
      nombre: v.contacto_nombre ?? "Consumidor final",
    };
  }
  // Por producto la venta se reparte entre sus ítems, así que esto no se usa
  // para agrupar la venta entera; ver `porProducto`.
  return { clave: v.id, nombre: v.id };
}

function acumular(
  mapa: Map<string, { nombre: string; actual: number; anterior: number }>,
  clave: string,
  nombre: string,
  monto: number,
  esActual: boolean,
) {
  const previo = mapa.get(clave) ?? { nombre, actual: 0, anterior: 0 };
  if (esActual) previo.actual += monto;
  else previo.anterior += monto;
  mapa.set(clave, previo);
}

/**
 * Descompone el cambio de las ventas netas entre dos períodos.
 *
 * `nombresDeProducto` traduce el id a algo legible. Cuando falta, se dice
 * "Producto sin nombre" en vez de mostrar un uuid: un identificador en
 * pantalla es ruido que nadie puede accionar.
 */
export function descomponerVentas(
  hechos: Hechos,
  actual: Periodo,
  anterior: Periodo,
  dimension: Dimension,
  moneda: string,
): Descomposicion {
  const ventas = (hechos.ventas ?? []).filter((v) => monedaConocida(v.moneda) === moneda);
  const nombres = new Map((hechos.productos ?? []).map((p) => [p.id, p.nombre]));

  const mapa = new Map<string, { nombre: string; actual: number; anterior: number }>();

  for (const v of ventas) {
    const esActual = dentroDe(v.fecha, actual);
    const esAnterior = dentroDe(v.fecha, anterior);
    if (!esActual && !esAnterior) continue;

    if (dimension === "cliente") {
      const { clave, nombre } = claveYNombre(v, dimension);
      acumular(mapa, clave, nombre, netoDe(v), esActual);
      continue;
    }

    // Por producto se reparte ítem por ítem: una venta puede tener varios, y
    // atribuirle el total al primero sería inventar.
    for (const it of v.items) {
      const clave = it.producto_id ?? "sin-producto";
      const nombre = it.producto_id
        ? (nombres.get(it.producto_id) ?? "Producto sin nombre")
        : "Sin producto asociado";
      acumular(mapa, clave, nombre, sinIva(it.total, it.iva), esActual);
    }
  }

  const totalActual = [...mapa.values()].reduce((s, x) => s + x.actual, 0);
  const totalAnterior = [...mapa.values()].reduce((s, x) => s + x.anterior, 0);
  const cambio = totalActual - totalAnterior;

  const aportes: Aporte[] = [...mapa]
    .map(([clave, x]) => ({
      clave,
      nombre: x.nombre,
      actual: x.actual,
      anterior: x.anterior,
      cambio: x.actual - x.anterior,
      // Sin cambio total no hay proporción que calcular: dividir por cero
      // daría Infinity y "este producto explica el ∞% de nada".
      proporcion: cambio === 0 ? 0 : (x.actual - x.anterior) / cambio,
    }))
    .filter((a) => a.cambio !== 0)
    .sort((a, b) => Math.abs(b.cambio) - Math.abs(a.cambio));

  return { dimension, moneda, totalActual, totalAnterior, cambio, aportes };
}

/**
 * Los pocos que explican la mayor parte del movimiento.
 *
 * Devuelve los primeros que juntos llegan a `umbral` del cambio. Es lo que
 * convierte una tabla de cuarenta filas en "tres productos explican el 68%",
 * que es la única forma en que un dato así se usa.
 */
export function principales(
  d: Descomposicion,
  umbral = 0.6,
): { aportes: Aporte[]; proporcion: number } {
  if (d.cambio === 0) return { aportes: [], proporcion: 0 };

  // Solo los que empujan PARA EL MISMO LADO que el cambio total. Mezclar los
  // que compensan haría que "los que explican la caída" incluya a uno que
  // subió, que es lo contrario de lo que la frase dice.
  const mismoLado = d.aportes.filter((a) => Math.sign(a.cambio) === Math.sign(d.cambio));

  const elegidos: Aporte[] = [];
  let acumulado = 0;

  for (const a of mismoLado) {
    elegidos.push(a);
    acumulado += a.proporcion;
    if (acumulado >= umbral) break;
  }

  return { aportes: elegidos, proporcion: acumulado };
}

/**
 * La frase, redactada como hecho aritmético y nunca como causa.
 *
 * `null` cuando no hay nada que decir. Ver el comentario de arriba sobre por
 * qué dice "explican" y no "causaron".
 */
export function redactar(d: Descomposicion, formatear: (n: number) => string): string | null {
  if (d.cambio === 0 || d.aportes.length === 0) return null;

  const { aportes, proporcion } = principales(d);
  if (aportes.length === 0) return null;

  const direccion = d.cambio > 0 ? "la subida" : "la caída";
  const cuantos = aportes.length === 1 ? "1" : String(aportes.length);
  const cosa =
    d.dimension === "producto"
      ? aportes.length === 1
        ? "producto"
        : "productos"
      : aportes.length === 1
        ? "cliente"
        : "clientes";

  const nombres = aportes.map((a) => a.nombre).join(", ");

  return (
    `${cuantos} ${cosa} explican el ${Math.round(Math.abs(proporcion) * 100)}% de ` +
    `${direccion} de ${formatear(Math.abs(d.cambio))}: ${nombres}.`
  );
}
