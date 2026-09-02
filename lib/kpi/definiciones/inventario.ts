import { sinIva } from "../../erp/margen.ts";
import { monedaConocida } from "../../finanzas/monedas.ts";
import { valorConocido, valorDesconocido } from "../tipos.ts";
import type { DefinicionKPI, Hechos, ProductoHecho, ValorKPI } from "../tipos.ts";

/**
 * Inventario, desde `eos_erp_productos`. Las dos fotos de acá son eso —fotos
 * de ahora, `instantanea: true`— porque el stock es un saldo del momento, sin
 * historia (`docs/erp-profesional-arquitectura.md`, §2). El día que exista
 * kardex valorizado (Fase 8 del plan de negocio), rotación y DIO se agregan
 * como definiciones nuevas; estas dos no cambian.
 */

function conControlDeStock(hechos: Hechos): ProductoHecho[] {
  return (hechos.productos ?? []).filter((p) => p.controla_stock && p.activo);
}

/**
 * El mismo criterio que `lib/erp/riesgos-negocio.ts` usa para el aviso
 * proactivo de "inventario bajo" — a propósito la misma definición, no una
 * segunda regla para la misma pregunta.
 */
export const PRODUCTOS_BAJO_MINIMO: DefinicionKPI = {
  id: "productos_bajo_minimo",
  nombre: "Productos bajo su stock mínimo",
  familia: "inventario",
  unidad: "cantidad",
  direccion: "menos_es_mejor",
  necesita: ["productos"],
  instantanea: true,
  umbrales: { atencion: 1, alerta: 5 },
  calcular(hechos): ValorKPI[] {
    const candidatos = conControlDeStock(hechos);
    const monedas = new Set(candidatos.map((p) => monedaConocida(p.moneda)));

    return [...monedas].sort().map((moneda) => {
      const cantidad = candidatos.filter(
        (p) => monedaConocida(p.moneda) === moneda && p.stock_actual <= p.stock_minimo,
      ).length;
      return valorConocido(moneda, cantidad);
    });
  },
};

/**
 * Cuánta plata está inmovilizada en lo que hay en el depósito, neta de IVA
 * igual que el resto de los indicadores de costo (`lib/erp/margen.ts`): el
 * IVA que pagaste por esa mercadería lo recuperás como crédito fiscal, no es
 * capital tuyo inmovilizado.
 *
 * `direccion: "neutro"` a propósito: tener capital en stock no es malo por sí
 * solo —es la mercadería que vas a vender— y este proyecto ya decidió no
 * inventar un umbral de "demasiado" sin la historia para saber qué es normal
 * en ESTE negocio (ver `lib/erp/riesgos-negocio.ts`, la nota sobre gastos
 * anormales).
 */
export const CAPITAL_INMOVILIZADO: DefinicionKPI = {
  id: "capital_inmovilizado",
  nombre: "Capital inmovilizado en stock",
  familia: "inventario",
  unidad: "moneda",
  direccion: "neutro",
  necesita: ["productos"],
  instantanea: true,
  calcular(hechos): ValorKPI[] {
    const conStock = conControlDeStock(hechos);
    const monedas = new Set(conStock.map((p) => monedaConocida(p.moneda)));

    return [...monedas].sort().map((moneda) => {
      const deMoneda = conStock.filter((p) => monedaConocida(p.moneda) === moneda);
      const costeados = deMoneda.filter((p) => p.costo !== null && p.costo > 0);

      if (costeados.length === 0) {
        return valorDesconocido(moneda, "Ningún producto con stock tiene costo cargado");
      }

      const total = costeados.reduce(
        (s, p) => s + sinIva(Number(p.costo) * p.stock_actual, p.iva),
        0,
      );

      const sinCosto = deMoneda.length - costeados.length;
      if (sinCosto === 0) return valorConocido(moneda, total);

      // Hay dato, pero incompleto: se dice el número Y que falta cargar el
      // resto, en vez de disimular como si estuviera completo.
      return {
        moneda,
        valor: total,
        confianza: {
          nivel: costeados.length / deMoneda.length,
          motivos: [`${sinCosto} de ${deMoneda.length} productos con stock no tienen costo cargado`],
        },
        falta: null,
      };
    });
  },
};

export const DEFINICIONES_INVENTARIO: DefinicionKPI[] = [PRODUCTOS_BAJO_MINIMO, CAPITAL_INMOVILIZADO];
