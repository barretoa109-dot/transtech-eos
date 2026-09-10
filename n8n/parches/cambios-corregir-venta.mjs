/**
 * CORREGIR_VENTA: "eran 3, no 30".
 *
 * ============================================================
 * EL ERROR MÁS FRECUENTE, Y EL QUE PEOR SE ARREGLABA
 * ============================================================
 *
 * No es un error del sistema: es un número hablado que se entendió mal. Pasa
 * con los montos y con las cantidades, y va a seguir pasando.
 *
 * `eos_erp_editar_venta` está en la base desde el 4 de septiembre —la escribió
 * el pedido de una usuaria: "debe poder editarse todo lo que sean compras y
 * ventas en todos sus apartados"— y desde el chat no había forma de llegar.
 * Quien se daba cuenta de que EOS entendió 30 donde dijo 3 tenía que anular y
 * redictar la venta entera, o ir a la pantalla.
 *
 * ============================================================
 * SE CORRIGE UN RENGLÓN, NO SE REDICTA LA VENTA
 * ============================================================
 *
 * Es lo que hace que este verbo sirva. La persona dice lo que cambia —"eran
 * 3"— y el resto de la venta queda como estaba. Pedirle la venta completa para
 * cambiar un número sería devolverle el trabajo que este producto le saca.
 *
 * ============================================================
 * CUÁNDO NO ES ESTE VERBO
 * ============================================================
 *
 * Si la venta entera está mal —el producto equivocado, el cliente equivocado—
 * es ANULAR_VENTA y volver a registrarla. Este verbo cambia cantidad o precio
 * de un renglón, y nada más.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "ANULAR_VENTA\n\nAcciones del negocio (ERP y CRM):",
    nuevo: "ANULAR_VENTA\nCORREGIR_VENTA\n\nAcciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de CORREGIR_VENTA",
    viejo: ["ANULAR_VENTA", "  datos: { referencia?, motivo? }"].join("\n"),
    nuevo: [
      "CORREGIR_VENTA",
      "  datos: { referencia?, producto?, cantidad?, precio_unitario?, motivo? }",
      "  Arreglar un número de una venta ya registrada. \"Eran 3, no 30\", \"esa",
      "  venta era a 150.000\", \"puse mal la cantidad del verde oliva\".",
      "  Va al menos uno de cantidad o precio_unitario: son lo que cambia.",
      "  referencia es cómo encontrar la VENTA —un monto, un producto, un",
      "  cliente— y es opcional: sin ella se corrige la más reciente de los",
      "  últimos siete días.",
      "  producto es cuál RENGLÓN de esa venta, y hace falta sólo si la venta",
      "  tiene más de uno. Si hace falta y no lo mandás, el sistema te lista los",
      "  productos para que preguntes cuál.",
      "  El resto de la venta no se toca: no le pidas a la persona que la",
      "  redicte entera para cambiar un número.",
      "  SI LO QUE ESTÁ MAL ES LA VENTA ENTERA —otro producto, otro cliente— eso",
      "  es ANULAR_VENTA y volver a registrarla. Este verbo cambia cantidad o",
      "  precio, nada más.",
      "",
      "ANULAR_VENTA",
      "  datos: { referencia?, motivo? }",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}
