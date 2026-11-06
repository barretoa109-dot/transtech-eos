import { calcularMargen } from "./margen.ts";
import type { TasaIva } from "./impuestos.ts";

/**
 * Qué productos del catálogo están vendiéndose con un margen muy por debajo
 * de lo normal en ESE MISMO negocio — y a qué precio volverían a estar en
 * línea.
 *
 * Es la pieza de "precios" que le faltaba al Optimization Engine (ítem 18 del
 * documento EOS 2030, `docs/estrategia/eos-2030-vision-tecnologica-2026-11-06.md`):
 * las otras tres combinaciones que pide el ítem —presupuesto, inventario,
 * compromisos— ya existen (`lib/finanzas/presupuesto.ts`,
 * `lib/erp/agotamiento.ts`, `lib/finanzas/planPago.ts`).
 *
 * ============================================================
 * EL "NORMAL" ES EL DEL PROPIO NEGOCIO, NUNCA UN NÚMERO INVENTADO
 * ============================================================
 *
 * No hay un margen "correcto" universal: una ferretería y una boutique viven
 * con márgenes típicos completamente distintos, y hasta dentro del mismo
 * rubro cada comercio tiene su propia estructura de costos. Proponer "deberías
 * tener 40% de margen" sería inventar un número con apariencia de
 * recomendación financiera — exactamente lo que `presupuesto.ts` ya explica
 * que no se puede hacer con el margen de seguridad.
 *
 * Acá el objetivo sale de la MEDIANA de los márgenes que el propio negocio ya
 * sostiene en el resto de su catálogo. Si la mayoría de los productos deja
 * 35% y este deja 6%, hay algo que revisar — y el precio que lo alinearía es
 * el que le daría el mismo 35% que ya tienen los demás, no un 40% que a nadie
 * se le preguntó.
 *
 * ============================================================
 * SOLO AVISA, NUNCA CAMBIA UN PRECIO SOLO
 * ============================================================
 *
 * Nivel 2 de autonomía ("preparar y recomendar"), igual que la propuesta de
 * reposición: una lista para revisar, nunca una escritura. Cambiar un precio
 * sin que el dueño lo vea podría ahuyentar a un cliente fiel al que
 * deliberadamente se le cobra distinto, o romper una promoción en curso.
 *
 * ============================================================
 * POR QUÉ HACE FALTA UN PISO DE PRODUCTOS
 * ============================================================
 *
 * Con dos o tres productos cargados la "mediana del negocio" es un dato
 * frágil: un catálogo chico con un solo producto de margen alto hace que
 * todos los demás parezcan desalineados. `MINIMO_PRODUCTOS` evita avisos
 * prematuros en catálogos que recién arrancan.
 */

const MINIMO_PRODUCTOS_CON_MARGEN = 5;

/** Por debajo de la mitad del margen típico del negocio, hay algo que mirar. */
const PROPORCION_MINIMA = 0.5;

export type ProductoConPrecio = {
  id: string;
  nombre: string;
  precio_venta: number;
  costo: number | null | undefined;
  iva: TasaIva;
  moneda: string;
};

export type PrecioDesalineado = {
  id: string;
  nombre: string;
  moneda: string;
  precio_actual: number;
  /** El que daría al producto el mismo margen típico que el resto del catálogo. */
  precio_sugerido: number;
  margen_actual: number;
  /** La mediana de márgenes del catálogo, el objetivo contra el que se compara. */
  margen_tipico: number;
};

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 1 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

function redondear(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/** El total con IVA que corresponde a un neto, el inverso de `sinIva`. */
function conIva(neto: number, tasa: TasaIva): number {
  if (tasa === 10) return neto * 1.1;
  if (tasa === 5) return neto * 1.05;
  return neto;
}

export function detectarPreciosDesalineados(productos: ProductoConPrecio[]): PrecioDesalineado[] {
  const conMargen = productos
    .map((producto) => ({
      producto,
      margen: calcularMargen({ costo: producto.costo, precio_venta: producto.precio_venta, iva: producto.iva }),
    }))
    .filter(
      (x): x is { producto: ProductoConPrecio; margen: Extract<typeof x.margen, { conocido: true }> } =>
        x.margen.conocido && !x.margen.pierde,
    );

  if (conMargen.length < MINIMO_PRODUCTOS_CON_MARGEN) return [];

  const margenTipico = mediana(conMargen.map((x) => x.margen.margen));
  // Un negocio cuya mediana ya es cero o negativa no tiene de dónde sacar un
  // "típico" que mejore nada: avisar ahí sería ruido, no una oportunidad.
  if (margenTipico <= 0) return [];

  return conMargen
    .filter((x) => x.margen.margen < margenTipico * PROPORCION_MINIMA)
    .map((x) => {
      // margenTipico% = (precioNeto - costoNeto) / precioNeto
      // → precioNeto = costoNeto / (1 - margenTipico/100)
      const precioNetoSugerido = x.margen.costo_neto / (1 - margenTipico / 100);
      const precioSugerido = Math.round(conIva(precioNetoSugerido, x.producto.iva));

      return {
        id: x.producto.id,
        nombre: x.producto.nombre,
        moneda: x.producto.moneda,
        precio_actual: x.producto.precio_venta,
        precio_sugerido: precioSugerido,
        margen_actual: redondear(x.margen.margen),
        margen_tipico: redondear(margenTipico),
      };
    })
    .sort((a, b) => a.margen_actual - b.margen_actual);
}
