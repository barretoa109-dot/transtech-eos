/**
 * La regla 6 nueva del campo "documento" (31/10/2026): cuando el contexto
 * trae el bloque "Compras y gastos del negocio YA CARGADOS"
 * (`lib/eos/compras-recientes.ts`, solo para TypeScript etapa 3 — el worker
 * de n8n no arma documentos hoy, pero el prompt es el mismo texto en los dos
 * lugares y `sistema.test.ts` lo exige), no hay que volver a preguntar esos
 * datos. El mismo texto que ya se sincronizó a mano en `lib/gateway/sistema.ts`.
 */

const N = "\n";

const VIEJA = "que no significa nada, y el lector lo va a leer como un error del sistema.";

const NUEVA =
  "que no significa nada, y el lector lo va a leer como un error del sistema." + N +
  '6. Si antes de este mensaje te llega un bloque "Compras y gastos del negocio YA CARGADOS", son datos reales de Compras y gastos: usalos en las tablas y no le preguntes a la persona algo que ya está ahí. Lo que de verdad falte (lo que no se carga en Compras, como el peso de entrada de un lote) preguntalo en "respuesta", en una conversación normal, ANTES de armar el archivo — no lo tapes con un bloque "nota" que la persona recién ve después de abrir el archivo.';

/** Aplica el cambio sobre el texto del prompt (nodo HTTP Request del gateway). */
export function aplicarPrompt(texto, etiqueta) {
  if (NUEVA.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en el texto a insertar`);

  if (!texto.includes(VIEJA)) {
    throw new Error(`[${etiqueta}] no encontré el final de las cuatro reglas del campo "documento"`);
  }

  return texto.replace(VIEJA, NUEVA);
}
