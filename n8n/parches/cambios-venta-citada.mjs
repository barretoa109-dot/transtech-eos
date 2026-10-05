/**
 * El prompt después de los dos casos de Sofía del 01/10/2026 (WhatsApp).
 *
 * 1. Citó "Costo final del zapato marrón mocha…" con "Registra la venta de
 *    esto"; después "Vendí a 160.000 gs. Era un sobrepedido de Gladys
 *    Velilla". "Sobrepedido" no tenía dónde ir (v231 agrega `nota`).
 * 2. EOS preguntó "¿A cuánto lo cobraste [el chaleco]?", ella contestó
 *    "155.000gs" y EOS lo tomó como el costo de la gorra Lacoste, le sumó un
 *    envío de la gorra, actualizó el catálogo y dijo "La acción quedó
 *    completada". Ella: "No es la gorra, es el chaleco de encaje".
 *
 * La causa de fondo no estaba en el prompt: el historial de WhatsApp no se
 * guardaba (lib/whatsapp/turno.ts), y el catálogo se cambia ahora solo con
 * pedido (lib/gateway/catalogo-pedido.ts). Esto es la tercera barrera, la del
 * modelo: una respuesta corta contesta la última pregunta, una corrección
 * manda, vender no es cambiar el catálogo, y lo que queda entre precio y costo
 * es margen bruto.
 *
 * Sin comillas invertidas: en n8n el prompt vive dentro de un literal de
 * plantilla. `aplicar` lo verifica.
 */

function despues(donde, ancla, agregado) {
  return { donde, viejo: ancla, nuevo: ancla + agregado.join("\n") + "\n" };
}

export const CAMBIOS = [
  {
    donde: "venta: la nota (v231)",
    viejo:
      "  datos: { items: [{ producto, cantidad, precio_unitario?, costo_unitario? }], contacto?, condicion?,\n" +
      "           vence_dia?, vence_en_dias?, vence_el? }\n" +
      "  El producto y el contacto van con el nombre tal como los llama el usuario.\n",
    nuevo:
      "  datos: { items: [{ producto, cantidad, precio_unitario?, costo_unitario? }], contacto?, condicion?,\n" +
      "           vence_dia?, vence_en_dias?, vence_el?, nota? }\n" +
      "  El producto y el contacto van con el nombre tal como los llama el usuario.\n" +
      [
        "  nota: lo que dijo de la venta que no es producto, cliente ni monto",
        "  (\"sobrepedido\", \"seña\", \"para regalo\"), en pocas palabras. Si no dijo",
        "  nada así, no la mandes.",
        "  Si no dice cuántas, es 1 cuando el monto es el precio de una unidad (el",
        "  del catálogo o el que dijo para ese producto). Si el monto no cierra",
        "  con una sola, preguntá solo la cantidad.",
      ].join("\n") +
      "\n",
  },
  despues(
    "respuesta corta, corrección y catálogo (01/10/2026)",
    "  que responde a un mensaje que no tenés guardado, pedí solo el dato que\n" +
      "  falta y decí de qué estás hablando.\n",
    [
      "- UNA RESPUESTA CORTA CONTESTA TU ÚLTIMA PREGUNTA. Si preguntaste \"¿a",
      "  cuánto lo cobraste?\" por un producto y te contesta solo un monto",
      "  (\"155.000gs\"), es el PRECIO DE VENTA de ESE producto: no es un costo ni",
      "  es de otro producto. Lo que en la conversación empieza con [de hace N",
      "  días] o [de hace N horas] es de otra conversación: no es la pregunta",
      "  que está esperando respuesta.",
      "- UNA CORRECCIÓN MANDA. \"No es la gorra, es el chaleco\": lo que dijiste",
      "  de la gorra para ese pedido se descarta y no vuelve, y nada de la gorra",
      "  (su envío, su costo) pasa al chaleco. Seguí solo con el chaleco, con su",
      "  costo del catálogo y lo que ya contestó; no lo vuelvas a preguntar. Si",
      "  por el error ya cambiaste algo, decilo y ofrecé volverlo atrás: no lo",
      "  cambies sin que te lo pida.",
      "- REGISTRAR UNA VENTA NO ES CAMBIAR EL CATÁLOGO. Con una venta no",
      "  mandes ACTUALIZAR_PRODUCTO, salvo que la persona pida cambiar el costo",
      "  o el precio de ese producto. Un costo o un envío es del producto con",
      "  el que se dijo: no se lo pases a otro. Si dos productos pueden ser y",
      "  no sabés cuál, preguntá cuál; no mezcles sus datos.",
      "- Lo que queda entre el precio y el costo es margen bruto: decí que te",
      "  deja esa diferencia antes de otros gastos, no que es la ganancia neta.",
    ],
  ),
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) {
      throw new Error(`[${etiqueta}] "${c.donde}" trae una comilla invertida, y en n8n eso corta el prompt.`);
    }
    // Ya aplicado: no se aplica dos veces.
    if (salida.includes(c.nuevo)) continue;

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
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
