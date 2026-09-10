/**
 * Que el modelo use el catálogo que ahora sí ve, y que "uno" deje de viajar
 * como nombre de producto.
 *
 * ============================================================
 * LA REGLA QUE ENVEJECIÓ EL MISMO DÍA QUE LLEGÓ EL CATÁLOGO
 * ============================================================
 *
 * El prompt decía:
 *
 *   "NO ADIVINES NOMBRES. Si el usuario dice pan y en su catálogo puede haber
 *    varios productos que empiecen así, preguntale cuál antes de pedir la
 *    acción."
 *
 * Escrita cuando el modelo NO veía el catálogo, esa regla no se podía cumplir
 * y se cumplía de la peor manera: ante cualquier duda, preguntar. Preguntar
 * "¿cuál de todos?" cuando hay uno solo es la forma más rápida de que alguien
 * deje de usar el chat.
 *
 * Desde la v158 el catálogo va en cada mensaje. La regla ahora sí se puede
 * cumplir, y se dice entera: preguntá cuando de verdad hay varios; cuando hay
 * uno solo, ese es.
 *
 * ============================================================
 * LAS DOS QUE SE AGREGAN
 * ============================================================
 *
 *   · Si lo que nombran NO está en el catálogo, la acción va IGUAL. Desde la
 *     v156 el sistema crea el producto con el precio que la persona acaba de
 *     decir y registra la venta en el mismo paso. Pedirle que lo cargue
 *     primero es mandarla a otra pantalla para algo que EOS hace solo.
 *
 *   · "uno", "ese", "el mismo" NO son nombres de producto. Una usuaria
 *     escribió "vendí uno a 185.000" después de tres mensajes hablando del
 *     mismo conjunto. Si eso viaja como producto: "uno", no hay resolución
 *     posible del otro lado y la venta se pierde con un error que no explica
 *     nada.
 */

export const CAMBIOS = [
  {
    donde: "la regla de no adivinar nombres",
    viejo: [
      "- NO ADIVINES NOMBRES. Si el usuario dice pan y en su catálogo puede haber",
      "  varios productos que empiecen así, preguntale cuál antes de pedir la",
      "  acción. Vender el producto equivocado descuenta el stock equivocado y",
      "  cobra el precio equivocado.",
    ].join("\n"),
    nuevo: [
      "- EL CATÁLOGO ESTÁ ARRIBA, en la sección \"Su catálogo\". Usá el nombre TAL",
      "  CUAL figura ahí. Si en esa lista hay VARIOS que podrían ser el que te",
      "  nombraron, preguntá cuál antes de pedir la acción: vender el producto",
      "  equivocado descuenta el stock equivocado y cobra el precio equivocado.",
      "  Pero si hay UNO SOLO que puede ser, ese es: no preguntes.",
      "- Si lo que te nombran NO está en el catálogo, mandá la acción IGUAL, con",
      "  el nombre como te lo dijeron. Cuando le pasás el precio, el sistema carga",
      "  el producto y registra la venta en el mismo paso. No le pidas a la",
      "  persona que lo cargue primero: eso ya lo hace EOS.",
      "- \"UNO\", \"ESE\", \"EL MISMO\", \"EL ANTERIOR\" NO SON NOMBRES DE PRODUCTO.",
      "  Cuando se refieran a algo que ya nombraron —en este mensaje o más arriba",
      "  en la conversación— resolvé de qué producto hablan y mandá SU NOMBRE.",
      "  Mandar \"uno\" como producto es una venta que se pierde.",
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
