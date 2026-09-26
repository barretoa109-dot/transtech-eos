/**
 * Cuánto cuesta en dólares un mensaje, con el descuento real de caché.
 *
 * ============================================================
 * POR QUÉ EXISTE (punto 8 del plan de fortalecimiento)
 * ============================================================
 *
 * Hasta el 23 de septiembre de 2026 `uso_mensual.costo_estimado_usd` cobraba
 * TODA la entrada a tarifa completa. OpenAI cobra los tokens de entrada que
 * encontró en su caché a una fracción de la tarifa (gpt-5.5: USD 5/M la
 * entrada, USD 0,50/M la entrada cacheada), y el prompt del sistema —la mayor
 * parte de cada pedido— es justamente lo que se cachea. Medido en septiembre,
 * el número guardado sobreestimaba el costo real unas 2,3 veces.
 *
 * Servía como cota superior para las alarmas, pero no para decidir si un
 * plan da pérdida. Ver docs/estrategia/plan-fortalecimiento-comercial-2026-09-22.md, 5.3.
 *
 * ============================================================
 * LA TARIFA CACHEADA ES UNA VARIABLE, NO UNA CONSTANTE
 * ============================================================
 *
 * Igual que las otras dos: la tarifa cambia con cada modelo. Si
 * `EOS_USD_POR_MTOK_ENTRADA_CACHEADA` no está configurada, los tokens
 * cacheados se cobran a la tarifa de entrada completa — o sea, exactamente
 * el número de antes. Nunca se inventa un descuento que nadie configuró: sin
 * la variable, el costo sigue siendo una cota superior segura.
 */

export type TokensMensaje = {
  entrada: number;
  /** Parte de `entrada` que OpenAI sirvió desde su caché. Nunca más que `entrada`. */
  entradaCacheada: number;
  salida: number;
};

export type TarifasUsd = {
  /** USD por millón de tokens de entrada. */
  entrada: number;
  /** USD por millón de tokens de entrada cacheados. */
  entradaCacheada: number;
  /** USD por millón de tokens de salida. */
  salida: number;
};

function noNegativo(valor: unknown): number {
  const n = Math.trunc(Number(valor ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function tarifa(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Lee los tokens tal como los mandan los gateways (TS o n8n).
 *
 * Los cacheados se recortan a la entrada: un gateway con un bug que mande más
 * cacheados que entrada no puede producir un costo menor que cero para la
 * parte sin caché.
 */
export function normalizarTokens(crudo: {
  tokens_entrada?: unknown;
  tokens_entrada_cacheados?: unknown;
  tokens_salida?: unknown;
}): TokensMensaje {
  const entrada = noNegativo(crudo.tokens_entrada);
  return {
    entrada,
    entradaCacheada: Math.min(noNegativo(crudo.tokens_entrada_cacheados), entrada),
    salida: noNegativo(crudo.tokens_salida),
  };
}

/** Las tarifas del entorno. La cacheada cae a la de entrada si falta. */
export function tarifasDelEntorno(env: Record<string, string | undefined> = process.env): TarifasUsd {
  const entrada = tarifa(env.EOS_USD_POR_MTOK_ENTRADA);
  const cacheadaConfigurada = String(env.EOS_USD_POR_MTOK_ENTRADA_CACHEADA ?? "").trim();
  return {
    entrada,
    entradaCacheada: cacheadaConfigurada === "" ? entrada : tarifa(cacheadaConfigurada),
    salida: tarifa(env.EOS_USD_POR_MTOK_SALIDA),
  };
}

/**
 * Las tarifas del modelo que contestó.
 *
 * Con el paso 4 del enrutamiento (`lib/eos/enrutamiento-modelo.ts`) un turno
 * simple lo puede contestar otro modelo, más barato, que tiene sus propias
 * tarifas: `EOS_USD_POR_MTOK_ENTRADA_SIMPLE`, `..._ENTRADA_CACHEADA_SIMPLE` y
 * `..._SALIDA_SIMPLE`. Si falta la de entrada o la de salida, se cobra a las
 * del modelo completo:
 * el consumo queda por encima del real, que es el lado seguro para el aviso de
 * los Gs. 70.000, y nunca se inventa un descuento que nadie configuró.
 *
 * `modelo` es el que se le pidió a OpenAI (`metadata.modelo` del gateway). Lo
 * que atiende n8n no lo trae y va a las tarifas de siempre.
 */
export function tarifasDelModelo(
  modelo: unknown,
  env: Record<string, string | undefined> = process.env,
): TarifasUsd {
  const simple = String(env.EOS_MODELO_SIMPLE ?? "").trim();
  const pedido = typeof modelo === "string" ? modelo.trim() : "";
  // Entrada y salida, las dos: con una sola, la otra se cobraría a cero.
  const configuradas =
    tarifa(env.EOS_USD_POR_MTOK_ENTRADA_SIMPLE) > 0 && tarifa(env.EOS_USD_POR_MTOK_SALIDA_SIMPLE) > 0;
  if (!simple || pedido !== simple || !configuradas) return tarifasDelEntorno(env);

  return tarifasDelEntorno({
    EOS_USD_POR_MTOK_ENTRADA: env.EOS_USD_POR_MTOK_ENTRADA_SIMPLE,
    EOS_USD_POR_MTOK_ENTRADA_CACHEADA: env.EOS_USD_POR_MTOK_ENTRADA_CACHEADA_SIMPLE,
    EOS_USD_POR_MTOK_SALIDA: env.EOS_USD_POR_MTOK_SALIDA_SIMPLE,
  });
}

/** El costo del mensaje en USD. Siempre finito y nunca negativo. */
export function costoDelMensaje(tokens: TokensMensaje, tarifas: TarifasUsd): number {
  const sinCache = Math.max(0, tokens.entrada - tokens.entradaCacheada);
  const costo =
    (sinCache / 1_000_000) * tarifas.entrada +
    (tokens.entradaCacheada / 1_000_000) * tarifas.entradaCacheada +
    (tokens.salida / 1_000_000) * tarifas.salida;
  return Number.isFinite(costo) && costo > 0 ? costo : 0;
}

/**
 * Lee `usage.input_tokens_details.cached_tokens` de la Responses API (o
 * `prompt_tokens_details.cached_tokens` de Chat Completions). Cero si no viene.
 */
export function cacheadosDeUsage(usage: unknown): number {
  const u = (usage && typeof usage === "object" ? usage : {}) as Record<string, unknown>;
  const detalle = (u.input_tokens_details ?? u.prompt_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  return noNegativo(detalle && typeof detalle === "object" ? detalle.cached_tokens : 0);
}

/**
 * Los tokens que informa la Responses API en `usage`, listos para
 * `costoDelMensaje`. Lo usan las llamadas al modelo que no pasan por el
 * gateway: la lectura de imágenes y el clasificador de WhatsApp del CRM.
 */
export function tokensDeUsage(usage: unknown): TokensMensaje {
  const u = (usage && typeof usage === "object" ? usage : {}) as Record<string, unknown>;
  return normalizarTokens({
    tokens_entrada: u.input_tokens ?? u.prompt_tokens,
    tokens_entrada_cacheados: cacheadosDeUsage(u),
    tokens_salida: u.output_tokens ?? u.completion_tokens,
  });
}

/**
 * Lo que cuesta transcribir un audio, por minuto.
 *
 * Whisper no informa tokens: cobra por duración. `EOS_USD_POR_MINUTO_AUDIO`
 * manda; si falta, USD 0,006, el precio de lista de whisper-1. A diferencia de
 * las tarifas del modelo, acá no se deja en cero: un audio sin costo es justo el
 * hueco que hacía llegar tarde el aviso de consumo.
 */
export const USD_POR_MINUTO_AUDIO_POR_DEFECTO = 0.006;

export function costoDeAudio(segundos: unknown, env: Record<string, string | undefined> = process.env): number {
  const s = Number(segundos);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const configurada = tarifa(env.EOS_USD_POR_MINUTO_AUDIO);
  const porMinuto = configurada > 0 ? configurada : USD_POR_MINUTO_AUDIO_POR_DEFECTO;
  return (s / 60) * porMinuto;
}
