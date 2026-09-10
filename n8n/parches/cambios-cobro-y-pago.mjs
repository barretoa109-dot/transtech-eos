/**
 * El chat aprende a cobrar una venta y a pagar una compra.
 *
 * ============================================================
 * LA CARTERA ESTABA CONSTRUIDA Y ENVEJECÍA SOLA
 * ============================================================
 *
 * La cuenta corriente existe desde el 2 de septiembre, con cobros parciales y
 * su reverso. El panel existe. Faltaba el verbo, y sin él quien vende a
 * crédito por chat tiene que ir a otra pantalla a marcar el cobro. Nadie lo
 * hace: la cartera queda llena de facturas cobradas hace semanas y "quién me
 * debe" pierde todo su valor.
 *
 * ============================================================
 * LO QUE EL PROMPT TIENE QUE IMPEDIR
 * ============================================================
 *
 * Que el modelo confunda cobrar una venta a crédito con registrar una venta
 * nueva. Son la misma plata contada dos veces: la venta ya está cargada, lo
 * que cambia es que ahora está cobrada.
 *
 * Y que confunda pagarle a un proveedor con registrar una compra. Idem.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "CORREGIR_MOVIMIENTO\nDECLARAR_SALDO\n\nAcciones del negocio (ERP y CRM):",
    nuevo:
      "CORREGIR_MOVIMIENTO\nDECLARAR_SALDO\nREGISTRAR_COBRO\nREGISTRAR_PAGO_COMPRA\n\n" +
      "Acciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de los dos verbos de cartera",
    viejo: ["REGISTRAR_GASTO_FIJO", "  datos: { fijos: [{ descripcion, monto, frecuencia?, tipo?, dia_del_mes? }] }"].join(
      "\n",
    ),
    nuevo: [
      "REGISTRAR_COBRO",
      "  datos: { cliente, monto?, fecha?, todo? }",
      "  Plata que ENTRA de un cliente que te debía. \"María me pagó la",
      "  factura\", \"Rossana me abonó 500 mil\", \"cobré lo de Pedro\".",
      "  NO es una venta nueva: la venta ya está cargada y lo que cambia es",
      "  que ahora está cobrada. Mandar REGISTRAR_VENTA acá contaría la misma",
      "  plata dos veces y encima descontaría el stock otra vez.",
      "  El cliente tiene que estar entre los contactos: no se inventa.",
      "  Si no te dicen el monto y el cliente tiene UNA sola factura abierta,",
      "  se cobra esa entera. Si tiene varias, el sistema te va a decir cuáles",
      "  son para que la persona elija — no elijas vos.",
      "  Si te dicen que pagó TODO lo que debía, mandá todo: true.",
      "  Un monto que no calza con una factura se imputa de la más vieja a la",
      "  más nueva, y el sistema informa a cuáles fue.",
      "  Es del NEGOCIO. La cuota de un préstamo de la persona es",
      "  REGISTRAR_PAGO_DEUDA.",
      "",
      "REGISTRAR_PAGO_COMPRA",
      "  datos: { proveedor, monto?, fecha?, todo? }",
      "  El espejo: plata que SALE hacia un proveedor al que le compraste a",
      "  crédito. \"Le pagué al proveedor de balanceado\", \"aboné 2 millones a",
      "  la distribuidora\".",
      "  Mismas reglas que REGISTRAR_COBRO.",
      "  NO es para una compra al contado: esa ya quedó pagada cuando se",
      "  registró. Esto salda lo que quedó debiendo, y mandar REGISTRAR_COMPRA",
      "  en su lugar cargaría el gasto por segunda vez.",
      "",
      "REGISTRAR_GASTO_FIJO",
      "  datos: { fijos: [{ descripcion, monto, frecuencia?, tipo?, dia_del_mes? }] }",
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
