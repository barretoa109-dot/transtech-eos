/**
 * El IVA paraguayo, que no se suma: se saca de adentro.
 *
 * ============================================================
 * EL ERROR QUE ESTO EVITA
 * ============================================================
 *
 * En Paraguay los precios se dicen CON IVA INCLUIDO. Cuando alguien dice que
 * un producto sale 55.000, el cliente paga 55.000 — no 60.500. De esos 55.000,
 * 5.000 son IVA al 10%.
 *
 * El error clásico de un sistema importado es tratar el precio como base
 * imponible y sumarle el impuesto encima. El resultado es una factura con un
 * 10% de más, un cliente que reclama y un usuario que deja de usar el módulo.
 *
 * La fórmula, entonces:
 *
 *   IVA 10% → impuesto = total / 11      (porque total = base × 1,1)
 *   IVA  5% → impuesto = total / 21      (porque total = base × 1,05)
 *   Exenta  → impuesto = 0
 *
 * ============================================================
 * REDONDEO
 * ============================================================
 *
 * Los guaraníes no tienen decimales. Cada línea se redondea a la unidad y el
 * total del documento es la SUMA DE LAS LÍNEAS REDONDEADAS, no el redondeo de
 * la suma. Es lo que hace que la factura impresa cierre cuando alguien la suma
 * a mano — y alguien siempre la suma a mano.
 */

export type TasaIva = 0 | 5 | 10;

export type LineaVenta = {
  descripcion: string;
  cantidad: number;
  /** Precio final por unidad, con IVA adentro. */
  precio_unitario: number;
  iva: TasaIva;
};

export type LineaCalculada = LineaVenta & {
  /** cantidad × precio, redondeado. Es lo que paga el cliente por esta línea. */
  total: number;
  /** La parte de `total` que es impuesto. */
  iva_monto: number;
  /** `total` menos el impuesto. */
  gravado: number;
};

export type TotalesVenta = {
  lineas: LineaCalculada[];
  /** Suma de los gravados: la base imponible del documento. */
  subtotal: number;
  iva_total: number;
  /** Lo que efectivamente se cobra. */
  total: number;
  /** Desglose por tasa, que es como lo pide el pie de una factura paraguaya. */
  por_tasa: { tasa: TasaIva; gravado: number; iva: number; total: number }[];
  /** Total exento, que va en su propia casilla. */
  exentas: number;
};

/** Divisor del que se saca el impuesto de un precio que ya lo incluye. */
function divisor(tasa: TasaIva): number {
  if (tasa === 10) return 11;
  if (tasa === 5) return 21;
  return 0;
}

function aGuaranies(valor: number): number {
  return Math.round(valor);
}

/** El impuesto contenido en un precio final. */
export function ivaIncluido(total: number, tasa: TasaIva): number {
  const d = divisor(tasa);
  return d === 0 ? 0 : aGuaranies(total / d);
}

export function calcularVenta(lineas: LineaVenta[]): TotalesVenta {
  const calculadas: LineaCalculada[] = lineas.map((linea) => {
    const total = aGuaranies(linea.cantidad * linea.precio_unitario);
    const iva_monto = ivaIncluido(total, linea.iva);

    return { ...linea, total, iva_monto, gravado: total - iva_monto };
  });

  const tasas: TasaIva[] = [10, 5, 0];

  const por_tasa = tasas
    .map((tasa) => {
      const suyas = calculadas.filter((l) => l.iva === tasa);

      return {
        tasa,
        gravado: suyas.reduce((t, l) => t + l.gravado, 0),
        iva: suyas.reduce((t, l) => t + l.iva_monto, 0),
        total: suyas.reduce((t, l) => t + l.total, 0),
      };
    })
    .filter((linea) => linea.total !== 0);

  return {
    lineas: calculadas,
    subtotal: calculadas.reduce((t, l) => t + l.gravado, 0),
    iva_total: calculadas.reduce((t, l) => t + l.iva_monto, 0),
    // La suma de las líneas ya redondeadas. Ver el comentario de cabecera.
    total: calculadas.reduce((t, l) => t + l.total, 0),
    por_tasa,
    exentas: calculadas.filter((l) => l.iva === 0).reduce((t, l) => t + l.total, 0),
  };
}

/**
 * La tasa, si es una de las tres que existen; si no, la general.
 *
 * La ausencia NO es exención. `Number(null)` y `Number("")` dan cero, así que
 * una tasa que falta se convertiría en "exenta" sin que nadie lo decida — y una
 * venta gravada facturada como exenta es un problema con la SET, no un detalle
 * de redondeo. Solo un cero escrito a propósito exime.
 */
export function tasaValida(valor: unknown): TasaIva {
  if (typeof valor === "number") {
    return valor === 0 || valor === 5 ? valor : 10;
  }

  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    return n === 0 || n === 5 ? n : 10;
  }

  return 10;
}
