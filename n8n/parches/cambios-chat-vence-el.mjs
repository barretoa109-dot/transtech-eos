/**
 * El chat entiende cuándo se paga o se cobra una venta o compra a crédito.
 *
 * ============================================================
 * EL HUECO
 * ============================================================
 *
 * El vencimiento se podía cargar desde la pantalla (v168, v180) pero no por el
 * chat: "le vendí a Carlos a crédito, me paga el 30" registraba la venta sin
 * fecha. Ver la migración v182.
 *
 * ============================================================
 * POR QUÉ EL MODELO NO MANDA UNA FECHA
 * ============================================================
 *
 * No sabe qué día es hoy: el prompt de sistema es idéntico para todos, a
 * propósito, para poder cachearlo. Convertir "el 30" a AAAA-MM-DD sería adivinar
 * el mes y el año, y un vencimiento equivocado es peor que ninguno.
 *
 * Así que manda LO QUE LA PERSONA DIJO —`vence_dia`, `vence_en_dias`, o
 * `vence_el` solo si dijo la fecha completa— y la base hace la cuenta con la
 * fecha de Paraguay.
 *
 * ============================================================
 * LAS FRASES DEL WORKER
 * ============================================================
 *
 * Con el resultado del ejecutor ahora dice la verdad entera:
 *
 *   · Venta a crédito con fecha: "Quedó a crédito: te la pagan el 30 de septiembre."
 *   · Compra a crédito: dice cuándo hay que pagar. Y deja de decir "el gasto ya
 *     está en el panel financiero", que era FALSO para una compra a crédito: la
 *     plata todavía no salió y no cuenta como gasto del mes.
 *
 * El prompt no puede tener comillas invertidas: vive dentro de un literal de
 * plantilla de JavaScript (ver `verificar.mjs`).
 */

export const CAMBIOS_PROMPT = [
  {
    donde: "REGISTRAR_VENTA: las formas de datos y el vencimiento",
    viejo: [
      "REGISTRAR_VENTA",
      "  datos: { items: [{ producto, cantidad, precio_unitario? }], contacto?, condicion? }",
      "  El producto y el contacto van con el nombre tal como los llama el usuario.",
      "  La condicion es contado o credito; si no la dice, es contado.",
      "",
      "AJUSTAR_STOCK",
    ].join("\n"),
    nuevo: [
      "REGISTRAR_VENTA",
      "  datos: { items: [{ producto, cantidad, precio_unitario? }], contacto?, condicion?,",
      "           vence_dia?, vence_en_dias?, vence_el? }",
      "  El producto y el contacto van con el nombre tal como los llama el usuario.",
      "  La condicion es contado o credito; si no la dice, es contado.",
      "  Si es a crédito y dicen CUÁNDO les pagan, mandá UNO de estos y no hagas la",
      "  cuenta vos (no sabés qué día es hoy; el sistema sí):",
      "    vence_dia      el día del mes: \"me paga el 30\" → 30",
      "    vence_en_dias  \"en 15 días\", \"a 30 días\" → 15, 30",
      "    vence_el       AAAA-MM-DD, SOLO si dicen la fecha completa con el año",
      "  Si no dicen cuándo, no lo preguntes: queda sin vencimiento.",
      "",
      "AJUSTAR_STOCK",
    ].join("\n"),
  },
  {
    donde: "REGISTRAR_COMPRA: las formas de datos",
    viejo: "           proveedor?, condicion?, fecha? }",
    nuevo: "           proveedor?, condicion?, fecha?, vence_dia?, vence_en_dias?, vence_el? }",
  },
  {
    donde: "REGISTRAR_COMPRA: el vencimiento",
    viejo: [
      "  Varios conceptos del mismo momento van en UNA compra, no en varias.",
      "  La condicion es contado o credito; si no la dice, es contado.",
      "",
      "REGISTRAR_COBRO",
    ].join("\n"),
    nuevo: [
      "  Varios conceptos del mismo momento van en UNA compra, no en varias.",
      "  La condicion es contado o credito; si no la dice, es contado.",
      "  Si es a crédito y dicen cuándo hay que PAGAR, va igual que en",
      "  REGISTRAR_VENTA: vence_dia, vence_en_dias o vence_el. Si no lo dicen, no",
      "  lo preguntes.",
      "",
      "REGISTRAR_COBRO",
    ].join("\n"),
  },
];

export const CAMBIOS_WORKER = [
  {
    donde: "la frase de la venta",
    viejo: [
      "  if (creados.length === 1) {",
      "    frases.push(",
      "      'Como \\u201C' + creados[0].nombre + '\\u201D no estaba en tu catálogo, lo cargué a \\u20B2 ' +",
    ].join("\n"),
    nuevo: [
      "  // Solo si hay una fecha: sin ella no hay nada que agregar (v182).",
      "  if (r.condicion === 'credito' && r.vence_el) {",
      "    frases.push('Quedó a crédito: te la pagan el ' + fechaLarga(r.vence_el) + '.');",
      "  }",
      "",
      "  if (creados.length === 1) {",
      "    frases.push(",
      "      'Como \\u201C' + creados[0].nombre + '\\u201D no estaba en tu catálogo, lo cargué a \\u20B2 ' +",
    ].join("\n"),
  },
  {
    donde: "la frase de la compra",
    viejo: "  frases.push('La ves en Negocio > Compras, y el gasto ya está en el panel financiero.');",
    nuevo: [
      "  /*",
      "    A crédito la plata todavía no salió: decir que 'el gasto ya está en el panel",
      "    financiero' era falso, y quien lo lee cree que ese mes ya pagó. Ahora dice",
      "    cuándo hay que pagar, que es lo que le sirve (v182).",
      "  */",
      "  if (r.condicion === 'credito') {",
      "    frases.push(",
      "      r.vence_el",
      "        ? 'La ves en Negocio > Compras. Quedó a pagar el ' + fechaLarga(r.vence_el) + ', y te aviso cuando esté por vencer.'",
      "        : 'La ves en Negocio > Compras. Quedó a crédito, sin fecha de pago, así que todavía no cuenta como gasto del mes.'",
      "    );",
      "  } else {",
      "    frases.push('La ves en Negocio > Compras, y el gasto ya está en el panel financiero.');",
      "  }",
    ].join("\n"),
  },
];

function aplicar(texto, cambios, etiqueta) {
  let salida = texto;

  for (const c of cambios) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}

export function aplicarPrompt(texto, etiqueta = "prompt") {
  if (texto.includes("vence_en_dias")) {
    throw new Error(`[${etiqueta}] el prompt ya conoce vence_en_dias. No se escribió nada.`);
  }
  return aplicar(texto, CAMBIOS_PROMPT, etiqueta);
}

export function aplicarWorker(codigo, etiqueta = "worker") {
  if (codigo.includes("r.condicion === 'credito'")) {
    throw new Error(`[${etiqueta}] las frases ya conocen la condición. No se escribió nada.`);
  }
  if (!codigo.includes("function fechaLarga")) {
    throw new Error(`[${etiqueta}] falta fechaLarga: aplicá primero el parche de fechas legibles.`);
  }
  return aplicar(codigo, CAMBIOS_WORKER, etiqueta);
}
