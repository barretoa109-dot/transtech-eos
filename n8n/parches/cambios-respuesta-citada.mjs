/**
 * Lo que la persona pide al citar un mensaje se refiere a ESE mensaje.
 *
 * ============================================================
 * EL DEFECTO (29/09/2026, WhatsApp)
 * ============================================================
 *
 * Sofía venía de registrar una venta a su clienta Sheyla. Después citó, con
 * "Responder", un mensaje viejo de EOS sobre una gorra Lacoste ("US$65, con
 * el dólar a ₲5.917,7 da ₲384.651") y escribió "Sumale el envío 41.241gs".
 * EOS le sumó el envío a la paleta de Sheyla, el último tema de la charla, y
 * registró la venta con ese costo.
 *
 * La cita no le llegaba al modelo (arreglado en el webhook, ver
 * `lib/whatsapp/cita.ts`). Esto es la otra mitad: ahora llega como
 * "En respuesta a este mensaje de EOS: > …", y la regla le dice que el pedido
 * es sobre eso, aunque la conversación reciente hable de otra cosa. Citar es
 * la forma más clara que tiene una persona de decir "de esto te hablo".
 *
 * Nada de acentos graves ni `${` en el texto: el prompt vive adentro de un
 * literal de plantilla en n8n (ver `verificar.mjs`).
 */

export const MARCA = "SI EL MENSAJE CITA OTRO MENSAJE";

export const CAMBIOS_PROMPT = [
  {
    donde: "la regla de la respuesta citada",
    viejo: '  te referís?" si en la conversación hay con qué entenderlo.\n',
    nuevo: [
      '  te referís?" si en la conversación hay con qué entenderlo.',
      `- ${MARCA} (empieza con "En respuesta a" y trae`,
      "  líneas con \">\"), lo que pide se refiere a ESE mensaje citado:",
      "  sus productos, sus montos, su tipo de cambio. Aunque la conversación",
      "  reciente hable de otra cosa u otro cliente, no lo mezcles con eso. Si",
      "  el citado tiene los datos para la cuenta, usalos sin preguntar. Si dice",
      "  que responde a un mensaje que no tenés guardado, pedí solo el dato que",
      "  falta y decí de qué estás hablando.",
      "",
    ].join("\n"),
  },
];

export function aplicarPrompt(texto, etiqueta) {
  if (texto.includes(MARCA)) return texto;
  const [c] = CAMBIOS_PROMPT;
  const partes = texto.split(c.viejo);
  if (partes.length !== 2) {
    throw new Error(`[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
  }
  return partes.join(c.nuevo);
}
