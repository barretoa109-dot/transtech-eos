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

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Postgres devuelve `timestamp without time zone` sin zona: es UTC. */
export function fecha(valor) {
  if (!valor) return null;
  const t = String(valor);
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(" ", "T")}Z`);
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

  if (ultimo !== null && ahora - ultimo > DIAS_SIN_VOLVER * DIA) {
    const dias = Math.floor((ahora - ultimo) / DIA);
    return { nivel: 2, estado: "SE ENFRIÓ", motivo: `no escribe hace ${dias} días` };
  }

  if (errores > 0) {
    return { nivel: 1, estado: "ok", motivo: `${ok} acciones bien, ${errores} con error` };
  }

  if (!primeraOk) {
    return { nivel: 1, estado: "nueva", motivo: "todavía dentro de las primeras 24 h" };
  }

  return { nivel: 0, estado: "ok", motivo: `${ok} acciones bien esta semana` };
}
