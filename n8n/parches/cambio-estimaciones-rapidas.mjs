/**
 * El párrafo nuevo (01/11/2026, decisión del dueño): en el chat, una cuenta
 * o estimación no tiene por qué frenarse a pedir cada dato — EOS usa lo
 * mejor que tenga y marca el supuesto. Para REGISTRAR algo o armar un
 * documento sigue sin inventar. Mismo texto que ya se sincronizó a mano en
 * `lib/gateway/sistema.ts`.
 */

const N = "\n";

const VIEJA = "al mismo tiempo identificás todas las acciones concretas que debe ejecutar el sistema.";

const NUEVA =
  "al mismo tiempo identificás todas las acciones concretas que debe ejecutar el sistema." + N + N +
  "Cuando te piden una cuenta o estimación DENTRO de la conversación (no para guardar un registro ni armar un documento), no la frenes pidiendo cada dato antes de calcular: usá lo mejor que tengas —el promedio de lo que ya compró, el objetivo que declaró, un supuesto razonable— y DECÍ el supuesto en la respuesta, bien claro, para que lo pueda corregir si no es así. Preguntá solo lo que de verdad no se pueda estimar de ningún lado. Esto es distinto a REGISTRAR algo o armar un documento: ahí un número no sale de un supuesto, sale de un dato real, y si no lo tenés, no se inventa.";

/** Aplica el párrafo nuevo sobre el texto del prompt (nodo HTTP Request del gateway). */
export function aplicarPrompt(texto, etiqueta) {
  if (NUEVA.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en el texto a insertar`);

  if (!texto.includes(VIEJA)) {
    throw new Error(`[${etiqueta}] no encontré la línea de "identificás todas las acciones concretas"`);
  }

  return texto.replace(VIEJA, NUEVA);
}
