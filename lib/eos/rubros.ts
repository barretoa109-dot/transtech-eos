/**
 * Los rubros del cliente ideal y cómo se le habla a cada uno el primer día
 * (fila D3 de docs/estrategia/plan-diferenciacion-2026-09-27.md).
 *
 * El primer minuto decide si alguien vuelve. De 5 cuentas reales, 3 nunca
 * recibieron nada útil de EOS (plan maestro, 26/09). Una de las razones es que
 * la persona tiene que adivinar qué escribir. Un ejemplo con SUS productos
 * ("Vendí 3 lechones a 450 mil") le dice en un segundo que esto es para ella,
 * cosa que "Vendí 2 remeras" no hace con un criador de cerdos.
 *
 * Los ejemplos se MUESTRAN, no se mandan: mandar "Vendí 3 lechones" registraría
 * una venta que no pasó. La tarjeta deja escrito el comienzo de la frase y la
 * persona la termina con lo suyo.
 *
 * El rubro se guarda en los metadatos de la cuenta de Supabase
 * (`user_metadata.rubro`): no hace falta tabla nueva para una palabra.
 */

export type ClaveRubro = "almacen" | "ropa" | "ferreteria" | "comida" | "campo" | "servicios" | "otro";

export type Rubro = {
  clave: ClaveRubro;
  etiqueta: string;
  /** Lo que se deja escrito y el ejemplo que se muestra, por tarjeta. */
  venta: string;
  compra: string;
  tercero: { titulo: string; subtitulo: string; relleno: string };
};

export const RUBROS: Rubro[] = [
  {
    clave: "almacen",
    etiqueta: "Almacén o despensa",
    venta: "Vendí 3 paquetes de yerba a 18 mil",
    compra: "Compré 10 cajas de gaseosa a 120 mil",
    tercero: { titulo: "Productos", subtitulo: "Ej.: «Agregá arroz 1 kg a 9.500»", relleno: "Agregá el producto " },
  },
  {
    clave: "ropa",
    etiqueta: "Ropa y calzado",
    venta: "Vendí 2 remeras a 85 mil a María",
    compra: "Compré 20 jeans a 95 mil cada uno",
    tercero: { titulo: "Costos", subtitulo: "Ej.: «La remera básica me cuesta 50 mil»", relleno: "Me cuesta " },
  },
  {
    clave: "ferreteria",
    etiqueta: "Ferretería y construcción",
    venta: "Vendí 5 bolsas de cemento a 65 mil",
    compra: "Compré 100 kilos de clavos a 18 mil el kilo",
    tercero: { titulo: "Productos", subtitulo: "Ej.: «Agregá el taladro a 450 mil»", relleno: "Agregá el producto " },
  },
  {
    clave: "comida",
    etiqueta: "Comida y bebidas",
    venta: "Vendí 12 empanadas a 5 mil",
    compra: "Compré 20 kilos de harina a 6 mil el kilo",
    tercero: { titulo: "Productos", subtitulo: "Ej.: «Agregá la hamburguesa completa a 25 mil»", relleno: "Agregá el producto " },
  },
  {
    clave: "campo",
    etiqueta: "Campo y animales",
    venta: "Vendí 3 lechones a 450 mil",
    compra: "Compré 10 bolsas de balanceado a 140 mil",
    tercero: { titulo: "Gastos fijos", subtitulo: "Ej.: «Le pago al capataz 1.500.000 por quincena»", relleno: "Le pago " },
  },
  {
    clave: "servicios",
    etiqueta: "Servicios",
    venta: "Cobré 350 mil por un service a Juan",
    compra: "Pagué 200 mil de combustible",
    tercero: { titulo: "Clientes", subtitulo: "Ej.: «Agregá a mi cliente Pedro Gómez»", relleno: "Agregá a mi cliente " },
  },
  {
    clave: "otro",
    etiqueta: "Otro rubro",
    venta: "Vendí 2 unidades a 80 mil cada una",
    compra: "Compré mercadería por 500 mil",
    tercero: { titulo: "Clientes", subtitulo: "Ej.: «Agregá a mi cliente Pedro Gómez»", relleno: "Agregá a mi cliente " },
  },
];

export function rubroDe(clave: unknown): Rubro | null {
  return RUBROS.find((r) => r.clave === clave) ?? null;
}

/** Las primeras palabras de un ejemplo, que es lo que se deja escrito en la caja. */
export function comienzo(ejemplo: string): string {
  return `${ejemplo.split(" ")[0]} `;
}
