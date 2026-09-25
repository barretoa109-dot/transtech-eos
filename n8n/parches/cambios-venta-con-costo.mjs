/**
 * El costo que EOS ya sabe viaja con la venta (25/09/2026).
 *
 * ============================================================
 * EL DEFECTO (una clienta real, por WhatsApp)
 * ============================================================
 *
 * Sofía dictó una venta de dos productos. EOS le contestó con el margen de
 * cada uno —venta, costo, ganancia, porcentaje— y en el mismo mensaje: "De 2
 * de esos productos no sé el costo, así que sus márgenes quedan pendientes:
 * pasámelos y los completo". Ella: "¿por qué decís que no tenés el costo, si
 * vos mismo me lo escribiste?".
 *
 * El modelo entendió el costo; REGISTRAR_VENTA no tenía dónde llevarlo. El
 * producto nacía sin costo y la frase del worker, que lee la base, decía la
 * verdad de la base. Ver la migración v198.
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * Prompt (gateway, nodo HTTP Request):
 *   · `items[].costo_unitario` en REGISTRAR_VENTA, y la regla: si usás un
 *     costo para calcular el margen en la respuesta, ese costo va en la venta.
 *
 * Worker (nodo "05 INT Respuesta", `fraseDeVenta`):
 *   · dice el costo que quedó puesto (`costos_puestos`, v198).
 *   · con varios productos sin costo, los NOMBRA. "De 2 de esos productos no
 *     sé el costo" no dice cuáles, obliga a adivinar, y no deja que
 *     `lib/eos/respuesta-visible.ts` saque el pedido cuando el costo sí se
 *     puso en la misma respuesta.
 *
 * El prompt no puede tener comillas invertidas ni `${`: vive dentro de un
 * literal de plantilla de JavaScript (ver `verificar.mjs`).
 */

export const CAMBIOS_PROMPT = [
  {
    donde: "el contrato de REGISTRAR_VENTA",
    viejo: "items: [{ producto, cantidad, precio_unitario? }]",
    nuevo: "items: [{ producto, cantidad, precio_unitario?, costo_unitario? }]",
  },
  {
    donde: "la regla del costo en la venta",
    viejo: "  Si no dicen cuándo, no lo preguntes: queda sin vencimiento.\n",
    nuevo: [
      "  Si no dicen cuándo, no lo preguntes: queda sin vencimiento.",
      "  El costo_unitario es lo que le cuesta UNA unidad a la persona. Si lo",
      "  sabés —lo dijo en este mensaje, está en la conversación, en tu memoria",
      "  o en el catálogo— mandalo en cada ítem, como número en guaraníes. Si",
      "  en la respuesta mostrás el margen o la ganancia de un producto, el",
      "  costo que usaste para calcularlo TIENE que ir en su costo_unitario:",
      "  si no, el sistema le dice a la persona que no sabe el costo que vos le",
      "  acabás de escribir. Si no lo sabés, no lo inventes: dejalo afuera y",
      "  el sistema se lo pide.",
      "",
    ].join("\n"),
  },
];

export const CAMBIOS_WORKER = [
  {
    donde: "la lista de costos puestos",
    viejo: "  const sinCosto = Array.isArray(r.sin_costo) ? r.sin_costo : [];\n",
    nuevo: [
      "  const sinCosto = Array.isArray(r.sin_costo) ? r.sin_costo : [];",
      "  const costos = Array.isArray(r.costos_puestos) ? r.costos_puestos : [];",
      "",
      "  const nombres = function (lista) {",
      "    const q = lista.map(function (n) { return '\\u201C' + n + '\\u201D'; });",
      "    return q.length > 1 ? q.slice(0, -1).join(', ') + ' y ' + q[q.length - 1] : q.join('');",
      "  };",
      "",
    ].join("\n"),
  },
  {
    donde: "la frase del costo pendiente",
    viejo: [
      "  if (sinCosto.length === 1) {",
      "    frases.push(",
      "      'Todavía no sé cuánto te cuesta \\u201C' + sinCosto[0] + '\\u201D, así que el margen queda pendiente: ' +",
      "      'decime el costo y lo completo.'",
      "    );",
      "  } else if (sinCosto.length > 1) {",
      "    frases.push(",
      "      'De ' + sinCosto.length + ' de esos productos no sé el costo, así que sus márgenes quedan pendientes: ' +",
      "      'pasámelos y los completo.'",
      "    );",
      "  }",
    ].join("\n"),
    nuevo: [
      "  /*",
      "    El costo que vino con la venta (v198). Se dice el número, igual que el",
      "    precio del producto creado: es lo único que permite ver en el momento",
      "    si EOS entendió 146.473 o 146.473.000.",
      "  */",
      "  if (costos.length === 1) {",
      "    frases.push(",
      "      'A \\u201C' + costos[0].nombre + '\\u201D le puse el costo de \\u20B2 ' + plata(costos[0].costo) +",
      "      ', así que su margen ya está calculado.'",
      "    );",
      "  } else if (costos.length > 1) {",
      "    frases.push(",
      "      'Les puse el costo a ' + costos.map(function (c) {",
      "        return '\\u201C' + c.nombre + '\\u201D (\\u20B2 ' + plata(c.costo) + ')';",
      "      }).join(', ') + ', así que sus márgenes ya están calculados.'",
      "    );",
      "  }",
      "",
      "  if (sinCosto.length === 1) {",
      "    frases.push(",
      "      'Todavía no sé cuánto te cuesta \\u201C' + sinCosto[0] + '\\u201D, así que el margen queda pendiente: ' +",
      "      'decime el costo y lo completo.'",
      "    );",
      "  } else if (sinCosto.length > 1) {",
      "    /*",
      "      Con nombre (25/09/2026). \"De 2 de esos productos\" no decía cuáles, y",
      "      la persona tenía que adivinar qué le estaban pidiendo.",
      "    */",
      "    frases.push(",
      "      'Todavía no sé cuánto te cuestan ' + nombres(sinCosto) + ', así que sus márgenes quedan pendientes: ' +",
      "      'pasame los costos y los completo.'",
      "    );",
      "  }",
    ].join("\n"),
  },
];

function aplicar(texto, cambios, etiqueta) {
  let salida = texto;

  for (const c of cambios) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);
    if (c.nuevo.includes("${")) throw new Error(`[${etiqueta}] "\${" en "${c.donde}"`);

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}

export function aplicarPrompt(texto, etiqueta = "prompt") {
  if (texto.includes("costo_unitario?")) {
    throw new Error(`[${etiqueta}] el prompt ya conoce costo_unitario. No se escribió nada.`);
  }
  return aplicar(texto, CAMBIOS_PROMPT, etiqueta);
}

export function aplicarWorker(codigo, etiqueta = "worker") {
  // `r.costos_puestos` solo no sirve de marca: CREAR_PRODUCTO ya lo usa.
  if (codigo.includes("le puse el costo de")) {
    throw new Error(`[${etiqueta}] la frase de la venta ya conoce costos_puestos. No se escribió nada.`);
  }
  return aplicar(codigo, CAMBIOS_WORKER, etiqueta);
}
