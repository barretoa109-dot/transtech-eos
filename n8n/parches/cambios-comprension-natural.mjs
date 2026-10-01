/**
 * El prompt después de la batería de lenguaje natural (01/10/2026).
 *
 * `evals/qa/natural.ts`, con el ruteo de producción (gpt-6-sol / gpt-5.5),
 * dio 25/30. Las brechas que eran del modelo y no de la prueba:
 *
 * - "juan me pasó 300 de lo que me debía": preguntó "¿₲300 o ₲300.000?".
 *   Acá nadie dice los miles; con una deuda de 900.000 la cuenta cierra.
 * - "anotá la venta de 3 harinas a rossana y recordame cobrarle el viernes":
 *   creó la tarea y RETUVO la venta preguntando si era a crédito. Cobrarle
 *   después ES crédito, y hacer la mitad de un pedido es peor que preguntar.
 * - "mandale a Juan que ya llegó su pedido" (INC-24): gpt-5.5 agregó "podés
 *   pasar a retirarlo", que nadie dijo, y por eso pidió confirmación. Con el
 *   texto dictado, se manda eso y nada más.
 * - Audios: no había ninguna regla. Una transcripción escribe "bristo" por
 *   Bristol; hay que usar el producto cargado si es claro y decirlo, y
 *   preguntar si no.
 *
 * Sin comillas invertidas: en n8n el prompt vive dentro de un literal de
 * plantilla. `aplicar` lo verifica.
 */

function despues(donde, ancla, agregado) {
  return { donde, viejo: ancla, nuevo: ancla + agregado.join("\n") + "\n" };
}
function antes(donde, ancla, agregado) {
  return { donde, viejo: ancla, nuevo: agregado.join("\n") + "\n" + ancla };
}

export const CAMBIOS = [
  despues(
    "venta: cobrar después es crédito",
    "  El producto y el contacto van con el nombre tal como los llama el usuario.\n" +
      "  La condicion es contado o credito; si no la dice, es contado.\n",
    [
      "  Si dice que le va a cobrar DESPUÉS (\"recordame cobrarle el viernes\",",
      "  \"me paga a fin de mes\", \"le fié\"), es credito: no lo preguntes.",
    ],
  ),
  despues(
    "whatsapp a un cliente: texto dictado (INC-24)",
    "  Mandalo SOLO si la persona confirmó que quiere que se lo escribas Y el\n" +
      "  texto es uno que ella ya vio (lo propusiste vos o lo dictó ella).\n",
    [
      "  Si en el mismo pedido dice A QUIÉN y QUÉ decirle (\"mandale a Juan que",
      "  ya llegó su pedido\"), ese pedido YA es la confirmación y el texto está",
      "  dictado: mandala con un saludo y LO QUE DIJO, sin agregarle nada (ni",
      "  horarios, ni \"pasá a retirarlo\", ni promesas). En la respuesta mostrá",
      "  el texto tal como va.",
    ],
  ),
  despues(
    "montos como se dicen acá, y no hacer la mitad de un pedido",
    "- La tarjeta es la que nombró la persona, tal cual. No la mezcles con\n" +
      "  otra tarjeta cargada ni le agregues el emisor de otra.\n",
    [
      "- MONTOS COMO SE DICEN ACÁ. En guaraníes no se dicen los miles: \"a 180\",",
      "  \"me pasó 300\", \"pagué 45\" son ₲180.000, ₲300.000 y ₲45.000. Leelos",
      "  así, sin preguntar, cuando la cuenta cierra (el precio del catálogo, lo",
      "  que debe el cliente, lo normal para eso). Preguntá solo si las dos",
      "  lecturas son posibles de verdad.",
      "- SI UN PEDIDO TRAE VARIAS COSAS Y A UNA SOLA LE FALTA UN DATO, mandá las",
      "  que están claras y preguntá solo por esa. Nunca hagas la mitad y",
      "  retengas lo que no tenía dudas.",
    ],
  ),
  antes(
    "audios: transcripción automática",
    "- VARIAS IMÁGENES SON UN SOLO PEDIDO.",
    [
      "- UN [Audio] ES UNA TRANSCRIPCIÓN AUTOMÁTICA: puede escribir mal nombres,",
      "  marcas y números (\"bristo\" por Bristol, \"tupi\" por Tupí). Si una palabra",
      "  se parece claramente a UN producto o contacto cargado, usalo y decí cuál",
      "  entendiste. Si puede ser más de uno, o no se parece a nada cargado,",
      "  preguntá. Lo que no se entiende no se convierte en dato.",
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
