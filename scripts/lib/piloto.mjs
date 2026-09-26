/**
 * Qué hacer con cada cuenta del piloto, a partir de sus números.
 *
 * El plan del piloto (`docs/estrategia/piloto-comercial-plan.md`) pide tratar
 * a una cuenta que no llega a una acción en 24 h como algo a INTERVENIR a mano,
 * y revisar cada semana los pedidos que fallan. Esto lo convierte en una lista
 * de a quién llamar hoy y por qué, ordenada por urgencia.
 */

export const HORAS_SIN_PRIMERA_ACCION = 24;
export const DIAS_SIN_VOLVER = 3;

/**
 * El aviso interno de consumo: el mismo número que `lib/monitoreo/umbral-costo.ts`
 * (un test los compara). Se repite acá porque este script corre con el Node de
 * la PC del dueño, que no ejecuta TypeScript solo.
 */
export const UMBRAL_COSTO_PYG = 70_000;
export const PYG_POR_USD_POR_DEFECTO = 8_000;

/** "consumo del mes: Gs. 72.800 (USD 9.1, 180 mensajes) — pasó los Gs. 70.000: revisar". */
export function lineaDeConsumo(costoUsd, mensajes, pygPorUsd = PYG_POR_USD_POR_DEFECTO) {
  const gs = (n) => `Gs. ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(n)}`;
  const usd = Number(costoUsd ?? 0);
  const cantidad = Number(mensajes ?? 0);
  if (!(usd > 0)) return `consumo del mes: sin costo registrado (${cantidad} mensajes)`;
  const pyg = Math.round(usd * pygPorUsd);
  const alerta = pyg >= UMBRAL_COSTO_PYG ? ` — pasó los ${gs(UMBRAL_COSTO_PYG)}: revisar` : "";
  return `consumo del mes: ${gs(pyg)} (USD ${Math.round(usd * 100) / 100}, ${cantidad} mensajes)${alerta}`;
}

const HORA = 3_600_000;
const DIA = 24 * HORA;

/**
 * Una fecha de Postgres, en milisegundos.
 *
 * `timestamp without time zone` llega sin zona: es UTC. `timestamptz` llega
 * con la zona CORTA —"2026-09-16 23:56:12.345+00"—, que `Date.parse` no
 * entiende: hasta el 26/09/2026 esas fechas salían nulas, y como el alta es
 * `timestamptz`, ninguna cuenta llegaba nunca a INTERVENIR. Se completa a "+00:00".
 */
export function fecha(valor) {
  if (!valor) return null;
  const t = String(valor)
    .trim()
    .replace(" ", "T")
    .replace(/(\d\d:\d\d(?::\d\d(?:\.\d+)?)?)([+-]\d\d)$/, "$1$2:00");
  const ms = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {{registro?: string|null, primera_accion_ok?: string|null, ultimo_mensaje?: string|null,
 *          acciones_error_7d?: number, acciones_ok_7d?: number, mensajes_7d?: number}} f
 * @returns {{nivel: 0|1|2|3, estado: string, motivo: string}} 3 = lo más urgente.
 */
export function evaluarCuenta(f, ahora = Date.now()) {
  const registro = fecha(f.registro);
  const primeraOk = fecha(f.primera_accion_ok);
  const ultimo = fecha(f.ultimo_mensaje);
  const errores = Number(f.acciones_error_7d ?? 0);
  const ok = Number(f.acciones_ok_7d ?? 0);

  if (!primeraOk && registro !== null && ahora - registro > HORAS_SIN_PRIMERA_ACCION * HORA) {
    const dias = Math.floor((ahora - registro) / DIA);
    return {
      nivel: 3,
      estado: "INTERVENIR",
      motivo: `se registró hace ${dias >= 1 ? `${dias} día${dias === 1 ? "" : "s"}` : "más de 24 h"} y EOS todavía no le hizo nada útil`,
    };
  }

  if (errores > 0 && errores >= ok) {
    return {
      nivel: 2,
      estado: "REVISAR",
      motivo: `${errores} pedido${errores === 1 ? "" : "s"} con error esta semana (y ${ok} bien): mirá qué pedía`,
    };
  }

  // La última señal de vida: el último mensaje o, si no hay ninguno guardado, la
  // primera acción. Sin esto, una cuenta con una acción de agosto y ningún mensaje
  // no llegaba nunca a SE ENFRIÓ y terminaba en "ok".
  const actividad = ultimo ?? primeraOk;
  if (actividad !== null && ahora - actividad > DIAS_SIN_VOLVER * DIA) {
    const dias = Math.floor((ahora - actividad) / DIA);
    const motivo = ultimo !== null ? `no escribe hace ${dias} días` : `no usa EOS hace ${dias} días`;
    return { nivel: 2, estado: "SE ENFRIÓ", motivo };
  }

  if (errores > 0) {
    return { nivel: 1, estado: "ok", motivo: `${ok} acciones bien, ${errores} con error` };
  }

  if (!primeraOk) {
    return { nivel: 1, estado: "nueva", motivo: "todavía dentro de las primeras 24 h" };
  }

  return { nivel: 0, estado: "ok", motivo: `${ok} acciones bien esta semana` };
}
