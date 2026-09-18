/**
 * Las reglas del prompt que faltaban para que cargar el negocio por chat no
 * termine en una nota ni en una orden que falla.
 *
 * ============================================================
 * LO QUE PASÓ (2026-09-18)
 * ============================================================
 *
 * Un usuario dictó su negocio. En un mismo mensaje el modelo mandó
 * REGISTRAR_COMPRA, AJUSTAR_STOCK ("lechones") y GUARDAR_MEMORIA. La compra
 * entró, el stock falló con "No encontré lechones entre tus productos", y en el
 * catálogo no quedó nada. Al día siguiente la persona creyó que EOS le había
 * borrado los datos. Nunca se cargaron.
 *
 * Dos causas, las dos en este texto:
 *
 * 1. La regla "si no está en el catálogo, mandá la acción IGUAL" está escrita
 *    para las ventas —el sistema crea el producto con el precio que le pasan—
 *    pero se lee como general. AJUSTAR_STOCK y ACTUALIZAR_PRODUCTO NO crean
 *    nada: con un producto que no existe fallan siempre.
 *
 * 2. CREAR_PRODUCTO es todo o nada. Un solo producto sin precio de venta hace
 *    fallar la tanda entera, y el modelo, sin salida limpia, cae en
 *    GUARDAR_MEMORIA, que nunca falla y suena a hecho.
 *
 * Esto es solo el prompt. El candado que no depende del modelo está en
 * `lib/eos/acciones-chat.ts` (`corregirAfirmacionSoloMemoria`).
 *
 * Sin comillas invertidas: el prompt vive en un literal de plantilla.
 */

export const CAMBIOS = [
  {
    donde: "productos sin precio dentro de una lista de CREAR_PRODUCTO",
    viejo: [
      "  Si el producto ya existe no se toca acá: para cambiarle el precio, el",
      "  costo o el IVA está ACTUALIZAR_PRODUCTO.",
    ].join("\n"),
    nuevo: [
      "  Si el producto ya existe no se toca acá: para cambiarle el precio, el",
      "  costo o el IVA está ACTUALIZAR_PRODUCTO.",
      "  Si te dan VARIOS productos y a alguno le falta el precio de venta,",
      "  mandá igual los que sí lo tienen y pedí, por nombre, el precio de los",
      "  que faltan. Nunca mandes la lista con un producto sin precio (falla",
      "  entera y no se carga ninguno) y nunca la reemplaces por",
      "  GUARDAR_MEMORIA: la persona se queda creyendo que quedó cargado.",
      "  También sirve para dar el stock inicial: si te dicen que tienen 6",
      "  lechones y el producto no está en el catálogo, es CREAR_PRODUCTO con",
      "  stock: 6, no AJUSTAR_STOCK.",
    ].join("\n"),
  },
  {
    donde: "qué acciones aceptan un producto que no está en el catálogo",
    viejo: [
      "- Si lo que te nombran NO está en el catálogo, mandá la acción IGUAL, con",
      "  el nombre como te lo dijeron. Cuando le pasás el precio, el sistema carga",
      "  el producto y registra la venta en el mismo paso. No le pidas a la",
      "  persona que lo cargue primero: eso ya lo hace EOS.",
    ].join("\n"),
    nuevo: [
      "- Si lo que te nombran NO está en el catálogo, mandá la acción IGUAL cuando",
      "  es REGISTRAR_VENTA (con el precio, el sistema carga el producto y registra",
      "  la venta en el mismo paso) o REGISTRAR_COMPRA (entra como concepto). No le",
      "  pidas a la persona que lo cargue primero: eso ya lo hace EOS.",
      "- AJUSTAR_STOCK y ACTUALIZAR_PRODUCTO son DISTINTAS: solo funcionan con un",
      "  producto que YA está en el catálogo. Si no está, no las mandes: fallan",
      "  siempre. Para que quede con existencias, mandá CREAR_PRODUCTO con nombre,",
      "  precio_venta y stock; si no te dijeron a cuánto lo venden, preguntalo en",
      "  la respuesta en vez de mandar una acción que va a fallar.",
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
