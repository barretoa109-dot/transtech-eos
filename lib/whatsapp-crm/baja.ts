/**
 * ¿El cliente está pidiendo que no le escriban más?
 *
 * ============================================================
 * POR QUÉ ES LA REGLA MÁS IMPORTANTE DE TODO EL CANAL
 * ============================================================
 *
 * Un cliente que pidió que no le escriban y recibe otro mensaje es la manera
 * más rápida de que WhatsApp califique el número de la empresa como spam, baje
 * su calidad y termine limitando o suspendiendo el canal. El costo lo paga la
 * empresa, no EOS. Por eso ante la duda se ACTÚA como baja.
 *
 * ============================================================
 * LOS DOS ERRORES NO PESAN LO MISMO
 * ============================================================
 *
 * Tomar una baja que no era: EOS deja de escribirle a alguien que solo dijo
 * "no me interesa esa marca". Se arregla con una llamada del dueño.
 * No tomar una baja que sí era: un mensaje no querido. No se arregla.
 *
 * Aun así NO se toma como baja un "no" suelto ni un "no gracias" a una oferta
 * concreta: eso es una respuesta comercial (el cliente sigue siendo cliente),
 * y confundirla haría perder oportunidades por nada. Lo que dispara la baja
 * es un pedido explícito de parar la comunicación.
 */

function limpiar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Una sola palabra o una frase mínima: lo que se manda a propósito para pedir la baja. */
const PALABRAS_SUELTAS = new Set(["stop", "baja", "basta", "unsubscribe", "cancelar", "parar"]);

/** Frases que, dentro de un mensaje más largo, piden dejar de recibir. */
const FRASES = [
  "no me escriban",
  "no me escribas",
  "no me escribas mas",
  "no me escriban mas",
  "no me manden mas",
  "no me envien mas",
  "no me molesten",
  "no me molestes",
  "dejen de escribirme",
  "deja de escribirme",
  "dejar de recibir",
  "no quiero recibir",
  "no quiero mas mensajes",
  "borrenme",
  "sacame de la lista",
  "sacame de esta lista",
  "saquenme de la lista",
  "saquenme de esta lista",
  "saquen mi numero",
  "quitame de la lista",
  "quitenme de la lista",
  "borrame de la lista",
  "sacarme de la lista",
  "darme de baja",
  "dame de baja",
  "quiero la baja",
  "no me contacten",
  "no me contactes",
  "no me llamen",
];

export function detectarBaja(texto: string | null | undefined): boolean {
  if (!texto) return false;

  const t = limpiar(texto);
  if (!t) return false;

  if (PALABRAS_SUELTAS.has(t)) return true;
  // "STOP." / "STOP por favor" — la palabra clave sigue siendo lo único que dice.
  if (t.split(" ").length <= 3 && [...PALABRAS_SUELTAS].some((p) => t.startsWith(`${p} `))) return true;

  return FRASES.some((f) => t.includes(f));
}
