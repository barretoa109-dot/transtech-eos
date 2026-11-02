/**
 * Dos cambios juntos (01/11/2026, de la misma demo en vivo):
 *
 *  1. GUARDAR_MEMORIA: guardar también un dato recurrente del negocio (una
 *     tasa de crecimiento, un consumo diario, un objetivo de precio) aunque
 *     no tenga su propio verbo y no se lo pidan — es lo que evita que otra
 *     conversación vuelva a preguntarlo.
 *  2. Tono: contestar directo y corto, sin sonar a sistema, sin repetir lo
 *     que la persona ya dijo ni acumular advertencias.
 *
 * Mismo texto que ya se sincronizó a mano en `lib/gateway/sistema.ts`.
 */

const N = "\n";

// ------------------------------------------------------------------
// 1) GUARDAR_MEMORIA: el párrafo nuevo después de "es el verbo."
// ------------------------------------------------------------------

const VIEJA_MEMORIA = "Ante la duda entre la memoria y un verbo del negocio, es el verbo.";

const NUEVA_MEMORIA =
  "Ante la duda entre la memoria y un verbo del negocio, es el verbo." + N +
  "  TAMBIÉN guardala cuando la persona te da un dato que vas a necesitar de" + N +
  "  nuevo para otra cuenta —cuánto crece algo por mes, cuánto consume por" + N +
  "  día, un objetivo de precio, un supuesto que repite— aunque no tenga su" + N +
  "  propio verbo y no te pida guardarlo. Hacelo en el momento, no esperes a" + N +
  "  que lo pida: es lo que evita que en otra conversación le vuelvas a" + N +
  "  preguntar algo que ya te dijo.";

// ------------------------------------------------------------------
// 2) El párrafo de tono, después de la regla de estimaciones rápidas.
// ------------------------------------------------------------------

const VIEJA_TONO =
  "ahí un número no sale de un supuesto, sale de un dato real, y si no lo tenés, no se inventa.";

const NUEVA_TONO =
  "ahí un número no sale de un supuesto, sale de un dato real, y si no lo tenés, no se inventa." + N + N +
  "Contestá directo y corto, como alguien que te está ayudando de verdad, no como un sistema. El número o la respuesta van primero; la explicación, después y solo si hace falta. No repitas en la respuesta lo que la persona ya te dijo en este mismo mensaje, no hagas una lista de advertencias por cada frase —una sola aclaración, la que de verdad importa, alcanza— y no des vueltas antes de llegar al punto.";

/** Aplica los dos cambios sobre el texto del prompt (nodo HTTP Request del gateway). */
export function aplicarPrompt(texto, etiqueta) {
  for (const t of [NUEVA_MEMORIA, NUEVA_TONO]) {
    if (t.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en el texto a insertar`);
  }

  let salida = texto;

  if (!salida.includes(VIEJA_MEMORIA)) {
    throw new Error(`[${etiqueta}] no encontré el final de la regla de GUARDAR_MEMORIA`);
  }
  salida = salida.replace(VIEJA_MEMORIA, NUEVA_MEMORIA);

  if (!salida.includes(VIEJA_TONO)) {
    throw new Error(`[${etiqueta}] no encontré el final de la regla de estimaciones rápidas`);
  }
  salida = salida.replace(VIEJA_TONO, NUEVA_TONO);

  return salida;
}
