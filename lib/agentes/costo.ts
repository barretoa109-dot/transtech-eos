/**
 * Cuánto cuesta una llamada a Claude, para `agent_runs.costo_usd`.
 *
 * Precios en USD por millón de tokens (API de Anthropic, vigentes al
 * 27/11/2026). La escritura de caché cuesta 1,25 veces la entrada; Batches,
 * la mitad de todo.
 *
 * Un modelo que no está en la tabla se cobra al precio del más caro de la
 * lista: este número alimenta el tope de gasto de cada agente, y es preferible
 * que corte antes a que se pase sin enterarse.
 */

type Tarifa = { entrada: number; salida: number; cacheLectura: number };

export const TARIFAS: Record<string, Tarifa> = {
  "claude-opus-5-5": { entrada: 4, salida: 20, cacheLectura: 0.2 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10, cacheLectura: 0.1 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, cacheLectura: 0.01 },
};

const MAS_CARA = TARIFAS["claude-opus-5-5"];

/** La forma de `response.usage` del SDK de Anthropic que importa acá. */
export type Uso = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function costoUsd(modelo: string, uso: Uso, { lote = false } = {}): number {
  const t = TARIFAS[modelo] ?? MAS_CARA;
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const total =
    (n(uso.input_tokens) * t.entrada +
      n(uso.cache_creation_input_tokens) * t.entrada * 1.25 +
      n(uso.cache_read_input_tokens) * t.cacheLectura +
      n(uso.output_tokens) * t.salida) /
    1_000_000;
  return Math.round((lote ? total / 2 : total) * 1_000_000) / 1_000_000;
}
