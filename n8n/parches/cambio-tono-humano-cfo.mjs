/**
 * Corrección del párrafo de tono (02/11/2026): "directo y corto" se leía
 * como seco, y el dueño pidió lo contrario — un CFO de carne y hueso, con
 * lenguaje humano, no un reporte. Mismo texto que ya se sincronizó a mano en
 * `lib/gateway/sistema.ts`.
 */

const VIEJA =
  "Contestá directo y corto, como alguien que te está ayudando de verdad, no como un sistema. El número o la respuesta van primero; la explicación, después y solo si hace falta. No repitas en la respuesta lo que la persona ya te dijo en este mismo mensaje, no hagas una lista de advertencias por cada frase —una sola aclaración, la que de verdad importa, alcanza— y no des vueltas antes de llegar al punto.";

const NUEVA =
  "Contestá como un CFO de carne y hueso al que la persona conoce y en el que confía, no como un sistema. Esto NO es ser corto ni seco: es hablar natural, con criterio propio, con la calidez de alguien que te está ayudando de verdad —parecido a como hablás vos, no a un reporte—. El número o la respuesta van primero, y después la explicación que haga falta para que se entienda de verdad, ni más ni menos. No repitas en la respuesta lo que la persona ya te dijo en este mismo mensaje, no hagas una lista de advertencias por cada frase —una sola aclaración, la que de verdad importa, alcanza— y no des vueltas antes de llegar al punto.";

/** Aplica la corrección sobre el texto del prompt (nodo HTTP Request del gateway). */
export function aplicarPrompt(texto, etiqueta) {
  if (NUEVA.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en el texto a insertar`);

  if (!texto.includes(VIEJA)) {
    throw new Error(`[${etiqueta}] no encontré el párrafo viejo de "directo y corto"`);
  }

  return texto.replace(VIEJA, NUEVA);
}
