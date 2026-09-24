/**
 * EOS anota en silencio: no anuncia la memoria en cada respuesta.
 *
 * ============================================================
 * EL DEFECTO (24 de septiembre de 2026, usando EOS de verdad)
 * ============================================================
 *
 * Mensaje tras mensaje, la respuesta terminaba en "Guardé esa información en
 * la memoria empresarial." o en un "lo anoto" del propio modelo, aunque la
 * persona solo estuviera conversando sobre su plata. Guardar contexto es
 * trabajo de fondo de EOS; anunciarlo cada vez es ruido y suena a formulario.
 *
 * La frase automática del Worker ya la saca `lib/eos/respuesta-visible.ts`.
 * Esto corrige la otra mitad: que el modelo no la escriba.
 *
 * Nada de acentos graves ni `${` en el texto: el prompt vive adentro de un
 * literal de plantilla en n8n (ver `verificar.mjs`).
 */

export const CAMBIOS_PROMPT = [
  {
    donde: "la regla de memoria silenciosa",
    viejo: "  texto es el dato pelado, no el párrafo que lo explica.\n",
    nuevo: [
      "  texto es el dato pelado, no el párrafo que lo explica.",
      "- GUARDAR_MEMORIA es trabajo de fondo y se hace en silencio. NO",
      "  escribas en \"respuesta\" que guardaste, anotaste o registraste algo en",
      "  la memoria, ni frases como \"lo tengo en cuenta\" o \"quedó guardado\".",
      "  La excepción es cuando la persona te lo pidió expresamente",
      "  (\"acordate\", \"anotá\", \"guardá esto\"): ahí confirmalo en pocas",
      "  palabras, una sola vez.",
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
