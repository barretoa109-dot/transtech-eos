/**
 * Cuánta plata de IA consume una cuenta en el mes antes del aviso interno.
 *
 * Decidido por el dueño el 26/09/2026: EOS Conversacional cuesta Gs. 80.000
 * por mes (Gs. 72.727 sin IVA), y a los Gs. 70.000 de consumo hay que avisar,
 * antes de que la cuenta dé pérdida. El aviso es para los dueños: nunca se le
 * muestra a la persona y no corta nada.
 *
 * Sin dependencias a propósito: lo usan el aviso (`uso-alto.ts`), la salud y
 * `npm run piloto`.
 */

export const UMBRAL_COSTO_PYG = 70_000;

/**
 * Guaraníes por dólar si falta `EOS_PYG_POR_USD`. El costo se guarda en
 * dólares, así que el umbral se convierte con esto. Un tipo de cambio más alto
 * que el real adelanta el aviso; nunca lo atrasa.
 */
export const PYG_POR_USD_POR_DEFECTO = 8_000;

/**
 * Lo que costó un mensaje medido el 19/09/2026 (v184). Solo se usa para la
 * cuenta que tiene el costo en cero —las tarifas no estaban cargadas—, para
 * medirla por cantidad de mensajes en vez de dejar el aviso mudo.
 */
export const USD_POR_MENSAJE_MEDIDO = 0.05;

type Entorno = Record<string, string | undefined>;

export function pygPorUsd(env: Entorno = process.env): number {
  const n = Number(env.EOS_PYG_POR_USD);
  return Number.isFinite(n) && n > 0 ? n : PYG_POR_USD_POR_DEFECTO;
}

/** El umbral en dólares, y en mensajes para la cuenta sin costo registrado. */
export function umbralCosto(env: Entorno = process.env): { usd: number; mensajesSinCosto: number } {
  const usd = UMBRAL_COSTO_PYG / pygPorUsd(env);
  return {
    usd: Math.round(usd * 100) / 100,
    mensajesSinCosto: Math.ceil(usd / USD_POR_MENSAJE_MEDIDO),
  };
}

export function aGuaranies(usd: number, env: Entorno = process.env): number {
  return Math.round(usd * pygPorUsd(env));
}

export function formatearGs(valor: number): string {
  return `Gs. ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(valor)}`;
}
