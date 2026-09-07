/**
 * Los tres cambios del prompt para ACTUALIZAR_PRODUCTO.
 *
 * Se definen UNA vez acá y se aplican a los dos lugares donde vive el prompt:
 * `lib/gateway/sistema.ts` y el nodo `HTTP Request` del gateway en n8n. El
 * parche de n8n importa este archivo, así que no pueden divergir.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones",
    viejo: ["CREAR_CONTACTO", "CREAR_PRODUCTO", "", "Acciones del negocio (ERP y CRM):"].join("\n"),
    nuevo: [
      "CREAR_CONTACTO",
      "CREAR_PRODUCTO",
      "ACTUALIZAR_PRODUCTO",
      "",
      "Acciones del negocio (ERP y CRM):",
    ].join("\n"),
  },
  {
    donde: "la forma de datos",
    viejo: [
      "  Si el producto ya existe no se toca: cambiar un precio es otra cosa y",
      "  todavía no la sabés hacer. Decilo así en la respuesta.",
      "",
      "Reglas de estas cuatro, que no se negocian:",
    ].join("\n"),
    nuevo: [
      "  Si el producto ya existe no se toca acá: para cambiarle el precio, el",
      "  costo o el IVA está ACTUALIZAR_PRODUCTO.",
      "",
      "ACTUALIZAR_PRODUCTO",
      "  datos: { productos: [{ nombre, precio_venta?, costo?, iva? }] }",
      '  Es para productos QUE YA EXISTEN: "el azul me sale 122.414 de costo",',
      '  "subí el amarillo a 200.000", "el top negro es exento".',
      "  Mandá SOLO los campos que cambian, y el nombre tal como está en el",
      "  catálogo.",
      "  El COSTO es lo que te cuesta a vos tener ese producto listo para",
      "  vender —lo que pagaste más el envío y todo lo que le sumes— y es de",
      "  donde sale el margen. Si el usuario lo calcula con vos, va ACÁ:",
      "  guardarlo como memoria deja el número en una conversación y el panel",
      "  de rentabilidad sigue sin poder calcular nada.",
      "  No toca el stock (para eso está AJUSTAR_STOCK) ni la moneda.",
      "",
      "Reglas de estas cinco, que no se negocian:",
    ].join("\n"),
  },
  {
    donde: "el resumen de lo entendido",
    viejo: '- Tu "respuesta" para estas tres dice QUÉ entendiste que hay que hacer: qué',
    nuevo: '- Tu "respuesta" para estas acciones dice QUÉ entendiste que hay que hacer: qué',
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;
  for (const c of CAMBIOS) {
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(
        `[${etiqueta}] "${c.donde}": el texto a reemplazar aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
      );
    }
    salida = partes.join(c.nuevo);
  }
  return salida;
}
