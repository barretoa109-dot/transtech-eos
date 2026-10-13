/**
 * El chat aprende a decir de qué caja del negocio salió o a cuál entró un
 * movimiento de venta, compra o cobranza/pago.
 *
 * El schema y las funciones SQL ya están en producción (v242;
 * `eos_resolver_caja_v240` contra `eos_empresa_cajas_v120`): esto sólo le
 * avisa al modelo que el campo `caja` existe y cuándo mandarlo. Opcional en
 * los tres casos — si no se dice, el movimiento queda sin caja asignada.
 */

export const CAMBIOS = [
  {
    donde: "REGISTRAR_VENTA: agrega el párrafo de caja",
    viejo: [
      "si no, el sistema le dice a la persona que no sabe el costo que vos le",
      "  acabás de escribir. Si no lo sabés, no lo inventes: dejalo afuera y",
      "  el sistema se lo pide.",
      "",
      "AJUSTAR_STOCK",
    ].join("\n"),
    nuevo: [
      "si no, el sistema le dice a la persona que no sabe el costo que vos le",
      "  acabás de escribir. Si no lo sabés, no lo inventes: dejalo afuera y",
      "  el sistema se lo pide.",
      "  caja SOLO si dijo a qué caja entró el cobro (\"a la cuenta del banco\",",
      "  \"en efectivo\"). Opcional: sin ella, el ingreso queda sin caja asignada.",
      "  Sólo aplica si la venta se cobra ahora (ver condicion/cobrada arriba).",
      "",
      "AJUSTAR_STOCK",
    ].join("\n"),
  },
  {
    donde: "REGISTRAR_COMPRA: agrega el párrafo de caja",
    viejo: [
      "  Si es a crédito y dicen cuándo hay que PAGAR, va igual que en",
      "  REGISTRAR_VENTA: vence_dia, vence_en_dias o vence_el. Si no lo dicen, no",
      "  lo preguntes.",
      "",
      "REGISTRAR_COBRO",
    ].join("\n"),
    nuevo: [
      "  Si es a crédito y dicen cuándo hay que PAGAR, va igual que en",
      "  REGISTRAR_VENTA: vence_dia, vence_en_dias o vence_el. Si no lo dicen, no",
      "  lo preguntes.",
      "  caja SOLO si dijo de dónde salió la plata, y sólo si la compra se paga",
      "  ahora (contado o pagada). Opcional: sin ella, el gasto queda sin caja",
      "  asignada.",
      "",
      "REGISTRAR_COBRO",
    ].join("\n"),
  },
  {
    donde: "REGISTRAR_COBRO: agrega el párrafo de caja (vale también para REGISTRAR_PAGO_COMPRA)",
    viejo: [
      "  Es del NEGOCIO. La cuota de un préstamo de la persona es",
      "  REGISTRAR_PAGO_DEUDA.",
      "",
      "REGISTRAR_PAGO_COMPRA",
    ].join("\n"),
    nuevo: [
      "  Es del NEGOCIO. La cuota de un préstamo de la persona es",
      "  REGISTRAR_PAGO_DEUDA.",
      "  caja SOLO si dijo a qué caja entró o de cuál salió el pago. Opcional:",
      "  sin ella, el movimiento queda sin caja asignada. Vale igual para",
      "  REGISTRAR_PAGO_COMPRA (mismas reglas).",
      "",
      "REGISTRAR_PAGO_COMPRA",
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
