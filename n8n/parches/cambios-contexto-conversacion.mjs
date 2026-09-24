/**
 * EOS usa lo que ya está en la conversación en vez de preguntarlo de nuevo.
 *
 * ============================================================
 * EL DEFECTO (24 de septiembre de 2026, una clienta real por WhatsApp)
 * ============================================================
 *
 * Sofía mandó la captura de un pedido (prendas con precio en dólares) y EOS
 * la pasó a guaraníes bien. Después escribió "45.577,2 envío vestido azul
 * claro, sumarle al costo de la prenda; 9.595,2 envío de cada camiseta" y,
 * respondiendo a la imagen, "estos". EOS preguntó dos veces "¿a qué
 * productos exactos?". La persona no tiene por qué explicarle a EOS cómo
 * hacer su trabajo.
 *
 * El motor ahora le pasa al modelo lo que se leyó en las imágenes anteriores
 * (v197, `lib/eos/imagenes-leidas.ts`). Esto es la otra mitad: la regla que
 * le dice qué hacer con eso.
 *
 * Nada de acentos graves ni `${` en el texto: el prompt vive adentro de un
 * literal de plantilla en n8n (ver `verificar.mjs`).
 */

export const CAMBIOS_PROMPT = [
  {
    donde: "la regla de usar el contexto de la conversación",
    viejo: "  palabras, una sola vez.\n",
    nuevo: [
      "  palabras, una sola vez.",
      "- Lo que ya está en la conversación NO se vuelve a preguntar. Si la",
      "  persona dice \"estos\", \"los de la foto\", \"lo de arriba\", responde a",
      "  una imagen o pide algo sin nombrar los productos, se refiere a lo",
      "  último que mandó o que hablaron (una imagen anterior, una lista, tu",
      "  respuesta previa): usalo directamente y hacé el trabajo.",
      "- Si pide sumar un costo extra (envío, flete, impuesto, comisión) a",
      "  productos, hacé vos la cuenta: costo final de cada uno = su costo",
      "  (convertido a guaraníes si venía en otra moneda, con el tipo de",
      "  cambio que ya se usó en la conversación) + el extra que le toca.",
      "  Mostrá el resultado por producto y mandá ACTUALIZAR_PRODUCTO con esos",
      "  costos. Si esos productos todavía no están en el catálogo, no",
      "  inventes el precio de venta: mostrá los costos calculados y preguntá",
      "  solo a cuánto los vende para cargarlos.",
      "- Si de verdad falta un dato, preguntá SOLO ese dato y decí lo que ya",
      "  entendiste (\"Entiendo que es el vestido azul claro y las 3",
      "  camisetas de la foto, ¿es así?\"). Nunca contestes solo con \"¿a qué",
      "  te referís?\" si en la conversación hay con qué entenderlo.",
      "",
    ].join("\n"),
  },
];

export function aplicarPrompt(texto, etiqueta) {
  let salida = texto;
  for (const c of CAMBIOS_PROMPT) {
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
