/**
 * Los tokens que OpenAI sirvió desde su caché viajan aparte.
 *
 * ============================================================
 * EL DEFECTO
 * ============================================================
 *
 * El nodo `05 GW Preparar Respuesta` leía `usage.input_tokens` y descartaba
 * `usage.input_tokens_details.cached_tokens`. La aplicación cobraba entonces
 * toda la entrada a tarifa completa, y `uso_mensual.costo_estimado_usd`
 * sobreestimaba el costo real ~2,3 veces (punto 8 del plan de
 * fortalecimiento, docs/estrategia/plan-fortalecimiento-comercial-2026-09-22.md).
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * `05` agrega `tokens_entrada_cacheados` al consumo y `08` lo pasa hasta la
 * respuesta final, igual que ya pasaba los otros dos. El precio se sigue
 * calculando del lado de la aplicación (`lib/eos/costo-mensaje.ts`): acá solo
 * viajan tokens, nunca dólares.
 *
 * Es aditivo: una aplicación vieja ignora el campo nuevo, y una nueva sin el
 * campo lo toma como cero — que es exactamente el costo de antes.
 */

export const CAMBIOS_05 = [
  {
    donde: "el consumo con los tokens cacheados",
    viejo: [
      "      tokens_entrada: Number(ai.usage.input_tokens || ai.usage.prompt_tokens || 0) || 0,",
      "      tokens_salida: Number(ai.usage.output_tokens || ai.usage.completion_tokens || 0) || 0",
      "    }",
      "  : { tokens_entrada: 0, tokens_salida: 0 };",
    ].join("\n"),
    nuevo: [
      "      tokens_entrada: Number(ai.usage.input_tokens || ai.usage.prompt_tokens || 0) || 0,",
      "      /* La parte de la entrada que OpenAI sirvió desde su caché: se cobra más barata. */",
      "      tokens_entrada_cacheados: Number(",
      "        ((ai.usage.input_tokens_details || ai.usage.prompt_tokens_details || {}).cached_tokens) || 0",
      "      ) || 0,",
      "      tokens_salida: Number(ai.usage.output_tokens || ai.usage.completion_tokens || 0) || 0",
      "    }",
      "  : { tokens_entrada: 0, tokens_entrada_cacheados: 0, tokens_salida: 0 };",
    ].join("\n"),
  },
];

export const CAMBIOS_08 = [
  {
    donde: "los tokens cacheados en la respuesta final",
    viejo: [
      "      tokens_entrada: base.tokens_entrada || 0,",
      "      tokens_salida: base.tokens_salida || 0,",
    ].join("\n"),
    nuevo: [
      "      tokens_entrada: base.tokens_entrada || 0,",
      "      tokens_entrada_cacheados: base.tokens_entrada_cacheados || 0,",
      "      tokens_salida: base.tokens_salida || 0,",
    ].join("\n"),
  },
];

function aplicarCambios(texto, cambios, etiqueta) {
  let salida = texto;
  for (const c of cambios) {
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

export function aplicar05(texto, etiqueta) {
  return aplicarCambios(texto, CAMBIOS_05, etiqueta);
}

export function aplicar08(texto, etiqueta) {
  return aplicarCambios(texto, CAMBIOS_08, etiqueta);
}
