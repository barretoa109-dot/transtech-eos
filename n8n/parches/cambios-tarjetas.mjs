/**
 * El chat aprende a cargar una tarjeta y una compra en cuotas.
 *
 * ============================================================
 * LO QUE EL PROMPT TIENE QUE IMPEDIR, Y ES LO MÁS FÁCIL DE HACER MAL
 * ============================================================
 *
 * Comprar con tarjeta NO es un gasto del mes. Si "compré la heladera en 6
 * cuotas de 500 mil" entrara como movimiento personal, la persona vería
 * 3.000.000 de gasto el día de la compra y después otra vez 500.000 cada mes
 * al pagar el resumen: la misma plata contada siete veces.
 *
 * Es el mismo error que ya se corrigió con las transferencias y con las
 * devoluciones, y por eso está escrito con esas palabras en el prompt: el
 * modelo tiene una atracción fuerte hacia REGISTRAR_MOVIMIENTO_PERSONAL
 * cuando escucha un monto y una cosa comprada.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "REGISTRAR_COBRO\nREGISTRAR_PAGO_COMPRA\n\nAcciones del negocio (ERP y CRM):",
    nuevo:
      "REGISTRAR_COBRO\nREGISTRAR_PAGO_COMPRA\nREGISTRAR_TARJETA\n" +
      "REGISTRAR_COMPRA_TARJETA\n\nAcciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de los dos verbos de tarjeta",
    viejo: ["CREAR_OBJETIVO", "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,"].join(
      "\n",
    ),
    nuevo: [
      "REGISTRAR_TARJETA",
      "  datos: { tarjeta, emisor?, linea?, saldo?, dia_cierre?,",
      "           dia_vencimiento?, pago_minimo?, pago_total?, moneda? }",
      "  La tarjeta de crédito de la persona, y su resumen. \"Mi Visa del Itaú",
      "  cierra el 20 y vence el 5\", \"tengo 5 millones de límite\", \"el resumen",
      "  de este mes vino 1.850.000 y el mínimo 320 mil\".",
      "  Crea o corrige sola: si ya tiene esa tarjeta, actualiza lo que le",
      "  mandes y no toca el resto. No preguntes si es nueva.",
      "  tarjeta es como LA LLAMA la persona —la Visa, la azul, la del Itaú—,",
      "  no como figura en el plástico: es el nombre con el que va a hablar de",
      "  ella la próxima vez.",
      "  El cierre y el vencimiento son DÍAS DEL MES, no fechas: se repiten.",
      "  Sin los dos, EOS no puede decir cuándo cae ni cuánto.",
      "",
      "REGISTRAR_COMPRA_TARJETA",
      "  datos: { descripcion, tarjeta?, cuota?, total?, cuotas?,",
      "           cuotas_pagadas?, primera_cuota? }",
      "  Algo comprado CON la tarjeta, en cuotas o de un pago. \"Compré la",
      "  heladera en 6 cuotas de 500 mil\", \"puse la notebook a 4.800.000 en 12",
      "  con la Visa\".",
      "  ESTO NO ES UN GASTO DEL MES, y es la razón por la que existe la",
      "  acción: lo que sale del bolsillo es el pago del resumen, no la compra.",
      "  Mandarlo como movimiento personal le carga 3.000.000 el día que compró",
      "  y otra vez 500.000 cada mes al pagar el resumen — la misma plata",
      "  contada siete veces.",
      "  Mandá cuota cuando te dicen cuánto es cada una, y total cuando te dicen",
      "  el precio. Si solo te dan el total, el sistema divide y AVISA que la",
      "  cuota es estimada: con intereses la real es más alta.",
      "  Si no dicen con cuál tarjeta y tiene una sola, se usa esa.",
      "",
      "CREAR_OBJETIVO",
      "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,",
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
