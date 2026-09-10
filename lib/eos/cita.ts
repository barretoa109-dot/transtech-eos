/**
 * Preguntar sobre un pedazo de lo que dijo EOS.
 *
 * ============================================================
 * QUÉ PROBLEMA RESUELVE
 * ============================================================
 *
 * EOS contesta un bloque con seis cifras y la persona quiere preguntar por
 * una: "¿por qué el margen es 32%?". Hoy tiene que copiar el número a mano y
 * escribir una frase que lo ubique, y aun así EOS tiene que adivinar de cuál
 * de los seis está hablando — el historial que viaja son diez mensajes de
 * texto plano, sin ninguna forma de señalar adentro de uno.
 *
 * Con la cita, el fragmento viaja aparte y marcado. No es lo mismo pegarlo
 * adentro del mensaje: pegado, el modelo lo lee como algo que la persona
 * escribió; aparte, sabe que es SU propia frase la que le están señalando, y
 * puede explicar de dónde salió ese número en vez de volver a calcularlo.
 *
 * ============================================================
 * POR QUÉ LA LÓGICA VIVE ACÁ Y NO EN EL COMPONENTE
 * ============================================================
 *
 * Porque lo que hay que probar no es el menú flotante: es que una selección
 * que cruza dos burbujas no se mande como si fuera de una, que un fragmento
 * enorme no infle el prompt, y que una selección de dos letras —el roce de un
 * dedo en el teléfono— no dispare nada.
 */

/**
 * El tope de lo que se cita.
 *
 * Mil caracteres son unos dos párrafos: alcanza de sobra para señalar una
 * cifra, una fila o una advertencia. Más que eso ya no es señalar, es mandar
 * la respuesta de vuelta, y cada carácter se paga dos veces —entra en el
 * prompt y sale en el razonamiento—.
 */
export const MAXIMO_CITA = 1_000;

/**
 * Lo mínimo para que una selección sea intencional.
 *
 * En el teléfono, apoyar el dedo selecciona una o dos letras sin que nadie lo
 * quiera. Abajo de tres caracteres no se ofrece nada: un menú que aparece solo
 * cuando la persona no hizo nada es peor que no tenerlo.
 */
export const MINIMO_CITA = 3;

/**
 * Deja la selección lista para viajar, o vacía si no sirve.
 *
 * Los saltos de línea se conservan —una tabla citada sin sus renglones no se
 * entiende— pero los espacios repetidos y los renglones vacíos se colapsan:
 * la selección del navegador arrastra la sangría del HTML, y eso son tokens
 * que no dicen nada.
 */
export function limpiarSeleccion(valor: unknown): string {
  if (typeof valor !== "string") return "";

  const limpio = valor
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n *(?:\n *)+/g, "\n")
    .trim();

  if (limpio.length < MINIMO_CITA) return "";

  if (limpio.length <= MAXIMO_CITA) return limpio;

  // Se corta y se dice que se cortó. Un fragmento truncado en silencio hace
  // que el modelo conteste sobre una frase que termina donde no terminaba.
  return `${limpio.slice(0, MAXIMO_CITA).trimEnd()}…`;
}

/**
 * ¿La selección es realmente de este mensaje?
 *
 * Una selección puede empezar en una burbuja y terminar en otra, y el
 * navegador la devuelve entera. Mandarla como cita de la primera sería
 * atribuirle a EOS palabras que escribió la persona, o al revés.
 *
 * Se compara sobre el texto normalizado porque el mensaje guardado tiene los
 * saltos que escribió el modelo y la selección trae los que puso el navegador
 * al renderizar; son la misma frase con distinta respiración.
 */
export function seleccionDentroDe(seleccion: string, mensaje: string): boolean {
  const aplanar = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

  const fragmento = aplanar(seleccion);
  if (!fragmento) return false;

  return aplanar(mensaje).includes(fragmento);
}

export type Cita = {
  /** El fragmento, ya limpio y acotado. */
  texto: string;
  /** De qué mensaje de EOS salió. Vacío si no se pudo saber. */
  mensajeId: string;
};

/**
 * Arma la cita a partir de lo que el navegador entregó.
 *
 * Devuelve `null` cuando no hay nada citable: es la única señal que el
 * componente necesita para no mostrar el menú.
 */
export function armarCita(
  seleccion: unknown,
  mensaje: string,
  mensajeId: string,
): Cita | null {
  const texto = limpiarSeleccion(seleccion);
  if (!texto) return null;

  // Se comprueba contra el original SIN cortar: una cita larga se recorta al
  // final, y el recorte nunca está adentro del mensaje.
  const crudo = typeof seleccion === "string" ? seleccion : "";
  if (!seleccionDentroDe(crudo, mensaje)) return null;

  return { texto, mensajeId };
}

/**
 * Cómo se le cuenta al modelo, para el camino que solo tiene texto.
 *
 * El campo estructurado (`cita` en el cuerpo del pedido) es el bueno y es el
 * que usa el prompt. Esto es el respaldo para cuando el mensaje viaja como
 * texto y nada más — el historial de la conversación, por ejemplo — y para que
 * la burbuja del usuario muestre a qué le está preguntando.
 *
 * El formato es el de una cita de correo, que es el que cualquier modelo y
 * cualquier persona leen sin explicación.
 */
export function textoConCita(mensaje: string, cita: Cita | null): string {
  if (!cita?.texto) return mensaje;

  const citado = cita.texto
    .split("\n")
    .map((linea) => `> ${linea}`)
    .join("\n");

  return `${citado}\n\n${mensaje}`.trim();
}
