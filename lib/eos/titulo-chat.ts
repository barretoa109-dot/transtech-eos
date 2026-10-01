/**
 * El título de una conversación (01/10/2026).
 *
 * Antes salía de palabras clave: "hola" → "Inicio con EOS", "gasto" → "Plan
 * financiero", "venta" → "Estrategia de negocio". La barra lateral se llenaba
 * de títulos iguales que no decían de qué se habló.
 *
 * Ahora, como en Claude: al mandar el primer mensaje aparece uno PROVISIONAL
 * tomado del mensaje, y con la primera respuesta un modelo barato escribe uno
 * corto y específico del tema. Si todavía no hay tema (solo un saludo), queda
 * "Nueva conversación" y se vuelve a intentar con los mensajes que siguen.
 */

export const TITULO_SIN_TEMA = "Nueva conversación";

/** Los títulos que se pueden reemplazar solos: los de fábrica y los de palabras clave de antes. */
export const TITULOS_AUTOMATICOS = new Set([
  "Nuevo chat",
  "Nuevo proceso EOS",
  "Diagnóstico actual",
  TITULO_SIN_TEMA,
  "Nueva conversación EOS",
  "Conversación EOS",
  "Inicio con EOS",
  "Plan financiero",
  "Estrategia de negocio",
  "Documento profesional",
  "Objetivos y organización",
]);

const SALUDO = /^(hola|buenas|buen d[ií]a|buenos d[ií]as|buenas tardes|buenas noches|hey|holi|qu[eé] tal|c[oó]mo est[aá]s|mba[ʼ']?[eé]ichapa)[\s!.,¡¿?]*$/i;

/** El título que se ve apenas se manda el primer mensaje. */
export function tituloProvisional(texto: string): string {
  const limpio = texto
    .replace(/\[(?:Imagen|Audio|Archivo)[^\]]*\]/gi, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio || SALUDO.test(limpio)) return TITULO_SIN_TEMA;

  const frase = limpio.split(/(?<=[.!?¿¡])\s/)[0].replace(/^[¿¡]+/, "").replace(/[.!?¿¡,;:]+$/g, "");
  const palabras = frase.split(" ").filter(Boolean).slice(0, 7);
  // Que no termine colgado: "…cerdo de raza de" → "…cerdo de raza".
  while (palabras.length > 2 && /^(de|del|la|las|el|los|en|a|al|y|o|para|con|un|una|por|que|mi|tu|su)$/i.test(palabras[palabras.length - 1])) {
    palabras.pop();
  }
  let titulo = palabras.join(" ");
  if (titulo.length > 48) titulo = `${titulo.slice(0, 47).trimEnd()}…`;
  if (titulo.length < 4) return TITULO_SIN_TEMA;
  return titulo.charAt(0).toUpperCase() + titulo.slice(1);
}

export const INSTRUCCIONES_TITULO = [
  "Escribí el título de esta conversación para la barra lateral de una app, como lo hace Claude.",
  "De 2 a 6 palabras, en español, específico del tema concreto (qué producto, qué cálculo, qué decisión).",
  "Sin comillas, sin punto final, sin emojis, sin la palabra EOS ni \"conversación\".",
  "Mayúscula solo al principio y en nombres propios.",
  "Si todavía no hay ningún tema (solo saludos o una prueba), respondé exactamente: SIN_TEMA",
  "Respondé solo el título.",
].join("\n");

/** El título que devolvió el modelo, listo para guardar; null si no sirve. */
export function limpiarTituloDelModelo(salida: unknown): string | null {
  if (typeof salida !== "string") return null;
  let t = salida
    .split("\n")[0]
    .replace(/^t[ií]tulo\s*:\s*/i, "")
    .replace(/["'«»“”`*#]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[.。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || /SIN_TEMA/i.test(t)) return null;
  if (t.length > 60) t = `${t.slice(0, 59).trimEnd()}…`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
