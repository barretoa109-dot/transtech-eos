/**
 * Cuánto de la conversación ve el modelo en cada mensaje.
 *
 * ============================================================
 * EL CASO (29/09/2026, WhatsApp)
 * ============================================================
 *
 * Sofía trabajó 20 minutos seguidos con EOS: pasó tres capturas a guaraníes
 * (una con "Zapatos ADAMUMU marrón mocha: USD 14,92 × 6.014,85 = ₲89.742"),
 * sumó envíos a blusas y chalecos, registró una venta y agendó una clienta.
 * Siete turnos después de la conversión pidió "agregale el costo de envío a
 * zapatos marrón mocha". EOS le pidió el tipo de cambio.
 *
 * El dato estaba en la conversación, pero no en lo que el modelo recibía: el
 * historial eran los últimos 10 mensajes —cinco turnos—, y la conversión había
 * quedado en el sexto. Para ella, EOS se había olvidado de algo que él mismo
 * había calculado un cuarto de hora antes. Eso es lo que se lee como "tonto".
 *
 * ============================================================
 * LA REGLA
 * ============================================================
 *
 * Siempre los últimos 10 mensajes, como antes. Además, hasta 24 si son de la
 * misma sesión de trabajo: las últimas tres horas. Una charla de ayer no se
 * arrastra; una tarde de trabajo, sí.
 *
 * Medido el 29/09 sobre 14 días: una sesión media de tres horas tiene 12
 * mensajes y el p90, 28. Un turno son unos 370 caracteres (~100 tokens), así
 * que el caso de 24 agrega ~700 tokens: USD 0,0035 por mensaje con gpt-5.5, y
 * solo en las sesiones largas, que son las que más valen.
 *
 * ============================================================
 * EL ORDEN
 * ============================================================
 *
 * La pregunta y la respuesta de un turno se guardan en el MISMO insert, así
 * que tienen el mismo `created_at` al microsegundo. Ordenar solo por fecha
 * deja el orden entre las dos al azar, y el modelo podía leer la respuesta de
 * EOS ANTES de la pregunta que la originó. A igual hora, la persona va primero.
 */

/** Los que entran siempre, sin mirar la hora. */
export const HISTORIAL_BASE = 10;

/** El tope, para una sesión de trabajo larga. */
export const HISTORIAL_MAXIMO = 24;

/** Qué cuenta como la misma sesión de trabajo. */
export const SESION_MS = 3 * 3_600_000;

/**
 * El tope por mensaje. Una respuesta larga (un informe, una tabla) no puede
 * comerse el historial entero; dos mil caracteres alcanzan para cualquier
 * conversión o lista de productos de las que se usan después.
 */
export const MAX_TEXTO_HISTORIAL = 2_000;

export type FilaHistorial = { rol: string; texto: string; created_at?: string | null };

/**
 * `mensajes.created_at` es `timestamp` sin zona, en UTC: PostgREST lo devuelve
 * sin la "Z" y `Date` lo leería como hora local.
 */
export function fechaDeFila(valor: string | null | undefined): number {
  if (!valor) return Number.NaN;
  const conZona = /[zZ]|[+-]\d\d:?\d\d$/.test(valor) ? valor : `${valor.replace(" ", "T")}Z`;
  return new Date(conZona).getTime();
}

/** A igual hora, la persona antes que EOS. Estable para todo lo demás. */
export function enOrdenDeTurno<T extends FilaHistorial>(filas: T[]): T[] {
  const peso = (rol: string) => (rol === "eos" ? 1 : 0);
  return filas
    .map((fila, i) => ({ fila, i, t: fechaDeFila(fila.created_at) }))
    .sort((a, b) => {
      if (Number.isFinite(a.t) && Number.isFinite(b.t) && a.t !== b.t) return a.t - b.t;
      if (Number.isFinite(a.t) && Number.isFinite(b.t)) return peso(a.fila.rol) - peso(b.fila.rol) || a.i - b.i;
      return a.i - b.i;
    })
    .map((x) => x.fila);
}

/**
 * Lo que ve el modelo: filas en orden cronológico (de la más vieja a la más
 * nueva). Sin fechas —el historial que manda la web— no hay forma de saber
 * qué es de esta sesión, y entran las últimas `HISTORIAL_MAXIMO`.
 */
export function historialDeLaSesion<T extends FilaHistorial>(filas: T[], ahora = Date.now()): T[] {
  const ultimas = filas.slice(-HISTORIAL_MAXIMO);
  const corte = ultimas.length - HISTORIAL_BASE;

  return ultimas
    .filter((fila, i) => {
      if (i >= corte) return true;
      const t = fechaDeFila(fila.created_at);
      return !Number.isFinite(t) || ahora - t <= SESION_MS;
    })
    .map((fila) =>
      fila.texto.length > MAX_TEXTO_HISTORIAL
        ? { ...fila, texto: `${fila.texto.slice(0, MAX_TEXTO_HISTORIAL).trimEnd()}…` }
        : fila,
    );
}
