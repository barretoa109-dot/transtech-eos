/**
 * Varias fotos son un solo pedido, y los guaraníes van sin centavos
 * (25/09/2026, Sofía por WhatsApp).
 *
 * Sofía mandó dos capturas de un pedido (2 + 4 prendas) con "Pasame estas 6
 * prendas a guaraníes, 5.988,99 está el dólar". EOS contestó "en esta imagen
 * se ven 2 prendas, no 6", describió la otra sin convertirla y escribió los
 * montos como "₲113.970,4797".
 *
 * La causa principal era de WhatsApp: cada foto llegaba sola (ver la migración
 * v199 y `lib/whatsapp/rafaga.ts`). Esto es la otra mitad, la del modelo:
 *   · varias imágenes en un mensaje son UN pedido y se leen juntas.
 *   · no contradecir a la persona con lo que no se ve: hacer lo que se ve y
 *     decir qué falta.
 *   · una imagen sin pedido continúa lo que se venía haciendo.
 *   · guaraníes redondeados a entero, con punto de miles.
 *
 * Sin comillas invertidas ni `${`: el prompt vive dentro de un literal de
 * plantilla en n8n (ver `verificar.mjs`).
 */

export const MARCA = "VARIAS IMÁGENES SON UN SOLO PEDIDO";

export const CAMBIOS_PROMPT = [
  {
    donde: "las reglas de imágenes y conversión",
    viejo: "  te referís?\" si en la conversación hay con qué entenderlo.\n",
    nuevo: [
      "  te referís?\" si en la conversación hay con qué entenderlo.",
      "- " + MARCA + ". Si el mensaje trae varias imágenes, leelas TODAS",
      "  antes de contestar y trabajá con el total (\"estas 6 prendas\" pueden",
      "  estar repartidas en dos capturas). Listá cada producto de cada",
      "  imagen, sin saltearte ninguno.",
      "- Nunca le digas a la persona que se equivoca con lo que vos no ves",
      "  (\"se ven 2, no 6\"). Hacé el trabajo con lo que sí ves y, si faltan,",
      "  decí cuántos encontraste y pedí solo lo que falta.",
      "- Si llega una imagen sin pedido, seguí lo que se venía haciendo en la",
      "  conversación (convertir, sumar envío, cargar): no te limites a",
      "  describirla. Si no hay nada en curso, describila y ofrecé lo más útil.",
      "- Al pasar a guaraníes, multiplicá cada precio por el tipo de cambio que",
      "  te dieron y REDONDEÁ al guaraní: los guaraníes no tienen centavos.",
      "  Escribilos con punto de miles y sin decimales (USD 19,03 a 5.988,99",
      "  = ₲113.970). Mostrá cada producto y el total.",
      "",
    ].join("\n"),
  },
];

export function aplicarPrompt(texto, etiqueta = "prompt") {
  if (texto.includes(MARCA)) {
    throw new Error(`[${etiqueta}] el prompt ya tiene las reglas de varias imágenes. No se escribió nada.`);
  }
  let salida = texto;
  for (const c of CAMBIOS_PROMPT) {
    if (c.nuevo.includes("`") || c.nuevo.includes("${")) throw new Error(`[${etiqueta}] carácter prohibido en "${c.donde}"`);
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }
  return salida;
}
