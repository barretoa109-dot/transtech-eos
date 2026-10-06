/**
 * La categoría que el chat nombra, y no la adivina sola (06/10/2026).
 *
 * ============================================================
 * EL DEFECTO
 * ============================================================
 *
 * El prompt le decía al modelo "No pongas categoria: EOS la deduce sola". Así
 * todo gasto anotado por chat dependía de las reglas de texto. Cuando la
 * persona ya dijo el rubro ("el almuerzo", "la veterinaria"), eso se perdía, y
 * el gasto caía en "Por clasificar" aunque EOS supiera dónde iba.
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * Prompt (gateway, nodo HTTP Request): el modelo pone `categoria` sólo cuando
 * la persona nombró el rubro, con la palabra que usó. Si no lo nombró, no la
 * pone. Nunca le pide a la persona que categorice.
 *
 * El clasificador (lib/finanzas/destinos.ts) reconoce "almuerzo" como comida y
 * "uber" como transporte, así que la palabra del chat no crea categorías
 * paralelas.
 *
 * El prompt no puede tener comillas invertidas ni `${`: vive dentro de un
 * literal de plantilla de JavaScript (ver `verificar.mjs`).
 */

/** Marca que dice que el cambio ya está. Evita aplicarlo dos veces. */
export const MARCA = "Categoria: poné la palabra con la que la persona nombró el rubro";

export const CAMBIOS_PROMPT = [
  {
    donde: "la regla de categoría de los movimientos personales",
    viejo: [
      "  No pongas categoria: EOS la deduce sola al mostrar el desglose. Pedirle",
      "  al usuario que categorice es justo el trabajo que este producto le",
      "  saca.",
      "",
    ].join("\n"),
    nuevo: [
      "  Categoria: poné la palabra con la que la persona nombró el rubro",
      "  (\"almuerzo\", \"granja\", \"veterinaria\"), sólo si lo dijo. Si no lo dijo,",
      "  no pongas categoria: EOS la deduce de la descripción y de las correcciones",
      "  que la persona ya hizo. Nunca le pidas que categorice.",
      "",
    ].join("\n"),
  },
];

/**
 * Aplica el cambio al texto del prompt. Si la marca ya está, no toca nada.
 * Si el texto viejo no aparece exactamente una vez, no escribe nada y avisa.
 */
export function aplicarPrompt(texto, etiqueta) {
  if (texto.includes(MARCA)) return texto;
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
