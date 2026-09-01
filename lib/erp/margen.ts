import { ivaIncluido, type TasaIva } from "./impuestos.ts";

/**
 * Cuánto se gana con cada producto, de verdad.
 *
 * ============================================================
 * EL IVA NO ES TUYO, Y POR ESO NO ENTRA EN LA GANANCIA
 * ============================================================
 *
 * En EOS los precios se cargan CON el IVA adentro, que es como se dicen acá:
 * el producto vale 100.000 y ese es el número del cartel. El costo también
 * viene así, porque se carga de la factura del proveedor.
 *
 * La cuenta ingenua —precio menos costo— da un número más grande que la
 * ganancia real, y no por poco. De los 100.000 que cobra, unos 9.090 son IVA
 * que le pertenece a la SET y va a salir en la próxima declaración. Del costo
 * pasa lo mismo al revés: el IVA que pagó al proveedor lo recupera como
 * crédito, así que su costo real es menor al que dice la factura.
 *
 * Mostrar la resta bruta le haría creer a un comerciante que gana más de lo
 * que gana. Y sobre esa creencia se fijan precios, se toman deudas y se decide
 * si conviene seguir vendiendo algo. Es exactamente el tipo de número que no
 * se puede aproximar "para simplificar".
 *
 * Así que las dos puntas se pasan a neto antes de restar.
 *
 * ============================================================
 * DOS NÚMEROS, PORQUE LA GENTE PIENSA EN LOS DOS
 * ============================================================
 *
 *   MARGEN   la ganancia sobre lo que COBRÁS. "De cada 100 que entran, me
 *            quedan 30." Es el que sirve para comparar productos entre sí.
 *
 *   MARCAJE  la ganancia sobre lo que PAGASTE. "Lo compro a 70 y lo vendo a
 *            100": 43%. Es el que usa casi todo el mundo en el mostrador para
 *            poner precios.
 *
 * No son lo mismo y confundirlos es un error caro: un marcaje del 50% es un
 * margen del 33%. Van los dos, con su nombre.
 */

export type Margen =
  | {
      /** Sin costo cargado no hay margen: no se inventa uno. */
      conocido: false;
      motivo: "sin-costo" | "sin-precio";
    }
  | {
      conocido: true;
      /** Lo que queda después de sacarle el IVA a las dos puntas. */
      ganancia: number;
      /** Ganancia sobre el precio neto, en porcentaje. */
      margen: number;
      /** Ganancia sobre el costo neto, en porcentaje. */
      marcaje: number;
      /** Vender por debajo del costo. Se marca aparte porque hay que verlo. */
      pierde: boolean;
      /** Los netos, por si la pantalla los quiere mostrar. */
      precio_neto: number;
      costo_neto: number;
    };

/** El precio sin el IVA que lleva adentro. */
export function sinIva(total: number, tasa: TasaIva): number {
  return total - ivaIncluido(total, tasa);
}

export function calcularMargen(datos: {
  costo: number | null | undefined;
  precio_venta: number | null | undefined;
  iva: TasaIva;
}): Margen {
  const precio = Number(datos.precio_venta ?? 0);
  const costo = Number(datos.costo ?? 0);

  if (!Number.isFinite(precio) || precio <= 0) {
    return { conocido: false, motivo: "sin-precio" };
  }

  /*
   * Un costo en cero no es "gana el 100%": es un costo que nadie cargó.
   *
   * Tratarlo como cero real mostraría "100% de margen" en todo producto recién
   * creado, que es un número precioso y completamente falso. Sin costo, no hay
   * margen que mostrar — y eso ya le dice al usuario qué le falta cargar.
   */
  if (!Number.isFinite(costo) || costo <= 0) {
    return { conocido: false, motivo: "sin-costo" };
  }

  const precio_neto = sinIva(precio, datos.iva);
  const costo_neto = sinIva(costo, datos.iva);
  const ganancia = precio_neto - costo_neto;

  return {
    conocido: true,
    ganancia,
    margen: precio_neto > 0 ? (ganancia / precio_neto) * 100 : 0,
    marcaje: costo_neto > 0 ? (ganancia / costo_neto) * 100 : 0,
    pierde: ganancia < 0,
    precio_neto,
    costo_neto,
  };
}

/** "30% de margen · 43% sobre el costo". Un decimal: más es precisión falsa. */
export function textoMargen(margen: Margen): string {
  if (!margen.conocido) {
    return margen.motivo === "sin-costo"
      ? "Cargá el costo para ver cuánto ganás"
      : "Cargá el precio de venta";
  }

  const redondo = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");

  return margen.pierde
    ? `Pierde ${redondo(Math.abs(margen.margen))}% en cada venta`
    : `${redondo(margen.margen)}% de margen · ${redondo(margen.marcaje)}% sobre el costo`;
}
