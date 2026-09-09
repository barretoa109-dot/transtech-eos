/**
 * El chat aprende a corregir un movimiento mal anotado.
 *
 * ============================================================
 * EL ÚNICO HUECO IRREVERSIBLE
 * ============================================================
 *
 * EOS entiende "gasté 50 mil en nafta" y lo anota solo. A veces entiende
 * 800.000 donde la persona dijo 80.000 — pasa con los montos hablados, y por
 * eso la pantalla devuelve lo entendido en el momento.
 *
 * Pero ver el error no alcanzaba: arreglarlo obligaba a ir a la lista de
 * movimientos. Un sistema que se equivoca y no se deja corregir hablando le
 * enseña a la persona a no usar el chat.
 *
 * Ver la migración v148 para por qué corrige y no borra, y por qué toma el más
 * reciente de siete días.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "REGISTRAR_DEUDA\nREGISTRAR_PAGO_DEUDA\n\nAcciones del negocio (ERP y CRM):",
    nuevo:
      "REGISTRAR_DEUDA\nREGISTRAR_PAGO_DEUDA\nCORREGIR_MOVIMIENTO\n\nAcciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de CORREGIR_MOVIMIENTO",
    viejo: [
      "CREAR_OBJETIVO",
      "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,",
    ].join("\n"),
    nuevo: [
      "CORREGIR_MOVIMIENTO",
      "  datos: { descripcion, monto?, fecha?, descripcion_nueva? }",
      "  Arreglar algo que quedó mal anotado en la plata de la persona.",
      '  "ese gasto de nafta era 80 mil, no 800 mil", "la compra del súper fue',
      '  ayer", "no era nafta, era gasoil".',
      "  descripcion es cómo ENCONTRAR el movimiento: la palabra con la que se",
      "  anotó. Los otros tres son lo que hay que cambiar, y va al menos uno.",
      "  Corrige el más reciente de los últimos siete días que coincida, y el",
      "  sistema informa cuál tocó y qué tenía antes.",
      "  Solo movimientos personales. Los del negocio salen de una venta o una",
      "  compra y se corrigen desde ahí.",
      "  NO BORRA. Si te piden borrar un movimiento, decile que lo haga desde",
      "  Personal, en la lista de movimientos: borrar por chat sobre una",
      "  coincidencia equivocada destruye un dato sin dejar rastro.",
      "  Si la persona te está corrigiendo algo que acabás de anotar mal, esta",
      "  es la acción — no vuelvas a mandar REGISTRAR_MOVIMIENTO_PERSONAL, que",
      "  dejaría el gasto cargado dos veces.",
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
