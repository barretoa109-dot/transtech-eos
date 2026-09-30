/**
 * El prompt después de la v227 (30/09/2026): un pago sin monto se pregunta.
 *
 * Hasta la v227, `eos_finanzas_pagar_deuda_v139` completaba con el pago
 * mínimo guardado cuando REGISTRAR_PAGO_DEUDA llegaba sin monto contra una
 * tarjeta, y el prompt se lo contaba al modelo ("Si no dice cuánto, el
 * sistema usa el pago mínimo del resumen"). Así un "ya pagué el mínimo" dicho
 * al pasar terminó anotado como ₲188.000 (caso Green, 29/09).
 *
 * Desde la v227 la base se niega (EOS_ACCION_PAGO_TARJETA_SIN_MONTO) y el
 * chat pregunta. Estas dos frases decían lo contrario y se corrigen:
 *
 * - el mínimo o el total del contexto se usan como monto SOLO cuando la
 *   persona pide anotar que pagó "el mínimo" o "el total";
 * - dicho al pasar, sigue siendo contexto (la regla del #213 no cambia);
 * - sin monto, no se manda la acción: se pregunta.
 *
 * Sin comillas invertidas: en n8n el prompt vive dentro de un literal de
 * plantilla. `aplicar` lo verifica.
 */

export const CAMBIOS = [
  {
    donde: "pago de tarjeta: siempre con monto (v227)",
    viejo: "  persona. Si no dice cuánto, el sistema usa el pago mínimo del resumen.\n",
    nuevo: [
      "  persona. Mandá siempre el monto: el que dijo, o el mínimo o el total",
      "  del resumen que ves en el contexto si dijo \"el mínimo\" o \"el total\".",
      "  Si no dice cuánto, no mandes la acción: preguntá cuánto pagó.",
      "",
    ].join("\n"),
  },
  {
    donde: "datos del contexto: la única excepción es el mínimo pedido",
    viejo:
      "  como si la persona los hubiera dicho —si falta el monto de un pago, lo\n" +
      "  completa el sistema, no vos—, ni en la respuesta como si fueran suyos\n",
    nuevo: [
      "  como si la persona los hubiera dicho —salvo el mínimo o el total del",
      "  resumen cuando pide anotar que pagó \"el mínimo\" o \"el total\"—, ni en",
      "  la respuesta como si fueran suyos",
      "",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) {
      throw new Error(
        `[${etiqueta}] "${c.donde}" trae una comilla invertida, y en n8n eso corta el prompt.`,
      );
    }

    // Ya aplicado: no se aplica dos veces.
    if (salida.includes(c.nuevo)) continue;

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

/** Gateway, nodo `HTTP Request`: el prompt. Pura, sin red. */
export function transformarGateway(flujo) {
  const http = flujo.nodes.find((n) => n.name === "HTTP Request");
  if (!http) throw new Error('No existe el nodo "HTTP Request".');
  http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");
  return flujo;
}
