/**
 * Los cambios del prompt para REGISTRAR_DEUDA y REGISTRAR_PAGO_DEUDA.
 *
 * Sin comillas invertidas en el texto: en n8n el prompt vive dentro de un
 * literal de plantilla y una comilla lo corta.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones",
    viejo: ["REGISTRAR_TRANSFERENCIA", "", "Acciones del negocio (ERP y CRM):"].join("\n"),
    nuevo: [
      "REGISTRAR_TRANSFERENCIA",
      "REGISTRAR_DEUDA",
      "REGISTRAR_PAGO_DEUDA",
      "",
      "Acciones del negocio (ERP y CRM):",
    ].join("\n"),
  },
  {
    donde: "la forma de datos",
    viejo: [
      "  Ojo con lo que SÍ es gasto: pagar una tarjeta, una cuota o a otra",
      "  persona no es transferencia entre cuentas propias.",
    ].join("\n"),
    nuevo: [
      "  Ojo con lo que SÍ es gasto: pagar una tarjeta, una cuota o a otra",
      "  persona no es transferencia entre cuentas propias.",
      "",
      "REGISTRAR_DEUDA",
      "  datos: { acreedor, saldo, tipo?, moneda?, cuota_monto?, cuota_dia?,",
      "           cuotas_totales?, cuotas_pagadas?, tasa_anual?, vence_el? }",
      '  Lo que la persona DEBE. "Debo 8 millones a Financiera Ueno, pago 800',
      '  mil el 10", "me quedan 3,5 millones de la tarjeta".',
      "  Crea o corrige sola: si ya tenés una deuda con ese acreedor, actualiza",
      "  los campos que le mandes y no toca el resto. No preguntes si es nueva.",
      "  El saldo es OBLIGATORIO cuando es nueva: sin él EOS no puede ordenar",
      "  los pagos, ni proyectar, ni decir en cuántos meses sale.",
      "  tipo: prestamo, tarjeta, proveedor, familiar, impuesto u otro.",
      "  LA TASA NO SE INVENTA NUNCA. Si no te la dijeron, no la mandes: una",
      "  tasa estimada se ve idéntica a una real y sobre ella se decide.",
      "  cuota_monto y cuota_dia van juntos o no van.",
      "",
      "REGISTRAR_PAGO_DEUDA",
      "  datos: { acreedor, monto?, fecha? }",
      '  Una cuota pagada. "Pagué la cuota de Ueno", "le pagué 800 mil a la',
      '  financiera".',
      "  Si no te dicen el monto, no lo mandes: el sistema usa la cuota",
      "  declarada. Si tampoco hay cuota, te va a pedir el monto — y está bien,",
      "  porque descontar un número inventado del saldo de una deuda es de los",
      "  errores más caros que puede cometer.",
      "  Hace DOS cosas: baja el saldo de la deuda y registra el gasto del mes.",
      "  Por eso no mandes además REGISTRAR_MOVIMIENTO_PERSONAL por el mismo",
      "  pago: quedaría contado dos veces.",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) {
      throw new Error(`[${etiqueta}] "${c.donde}" trae una comilla invertida.`);
    }
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(
        `[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
      );
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}
