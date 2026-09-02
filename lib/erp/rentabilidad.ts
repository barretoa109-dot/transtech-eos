import { sinIva } from "./margen.ts";
import type { TasaIva } from "./impuestos.ts";

/**
 * El margen de esta pantalla y el de `lib/erp/indicadores.ts` mostraban dos
 * números distintos de la misma plata: este restaba `venta − costo` con el
 * IVA todavía adentro de los dos, e indicadores.ts ya restaba neto. Una
 * clienta viendo "Rentabilidad" y "Cómo va el negocio" en la misma pantalla
 * podía leer dos márgenes distintos para el mismo mes. Por eso acá también se
 * neta antes de restar — ver `lib/erp/margen.ts` para el porqué completo.
 */
export type LineaRentabilidad = {
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  /** Con IVA incluido, tal como se guarda en el ítem de la venta. */
  venta: number;
  iva: TasaIva;
  /** Con IVA incluido, si se conoce. */
  costo_unitario: number | null;
  estimado: boolean;
  moneda: string;
};

export type ResumenRentabilidad = {
  moneda: string;
  ventas: number;
  costo: number;
  margen: number;
  margen_porcentaje: number | null;
  ventas_con_costo: number;
  ventas_sin_costo: number;
  contiene_estimaciones: boolean;
  productos: {
    clave: string;
    nombre: string;
    ventas: number;
    costo: number;
    margen: number;
    margen_porcentaje: number | null;
    unidades: number;
    estimado: boolean;
  }[];
};

export function calcularRentabilidad(lineas: LineaRentabilidad[]): ResumenRentabilidad[] {
  const monedas = new Map<string, LineaRentabilidad[]>();
  for (const linea of lineas) {
    const moneda = String(linea.moneda || "PYG").toUpperCase();
    monedas.set(moneda, [...(monedas.get(moneda) ?? []), linea]);
  }

  return [...monedas.entries()].map(([moneda, deMoneda]) => {
    const conCosto = deMoneda.filter((l) => l.costo_unitario !== null);

    /** Lo cobrado, sin el IVA que le pertenece a la SET. */
    const ventaNeta = (l: LineaRentabilidad) => sinIva(numero(l.venta), l.iva);
    /** Lo pagado por esas unidades, con el mismo criterio del lado del costo. */
    const costoNeto = (l: LineaRentabilidad) =>
      sinIva(numero(l.costo_unitario) * numero(l.cantidad), l.iva);

    const ventas = conCosto.reduce((s, l) => s + ventaNeta(l), 0);
    const costo = conCosto.reduce((s, l) => s + costoNeto(l), 0);
    const grupos = new Map<string, typeof conCosto>();
    for (const linea of conCosto) {
      const clave = linea.producto_id || `libre:${linea.descripcion.toLocaleLowerCase("es")}`;
      grupos.set(clave, [...(grupos.get(clave) ?? []), linea]);
    }

    const productos = [...grupos.entries()].map(([clave, filas]) => {
      const ventasProducto = filas.reduce((s, l) => s + ventaNeta(l), 0);
      const costoProducto = filas.reduce((s, l) => s + costoNeto(l), 0);
      return {
        clave,
        nombre: filas[0]?.descripcion || "Producto",
        ventas: ventasProducto,
        costo: costoProducto,
        margen: ventasProducto - costoProducto,
        margen_porcentaje: ventasProducto > 0 ? ((ventasProducto - costoProducto) / ventasProducto) * 100 : null,
        unidades: filas.reduce((s, l) => s + numero(l.cantidad), 0),
        estimado: filas.some((l) => l.estimado),
      };
    }).sort((a, b) => b.margen - a.margen);

    return {
      moneda,
      ventas,
      costo,
      margen: ventas - costo,
      margen_porcentaje: ventas > 0 ? ((ventas - costo) / ventas) * 100 : null,
      ventas_con_costo: conCosto.length,
      ventas_sin_costo: deMoneda.length - conCosto.length,
      contiene_estimaciones: conCosto.some((l) => l.estimado),
      productos,
    };
  });
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}
