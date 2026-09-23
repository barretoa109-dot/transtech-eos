/**
 * Tiempo al primer valor de las cuentas nuevas (punto 4.4 del plan, y
 * "Qué instrumentar" de docs/estrategia/piloto-comercial-plan.md).
 *
 * El primer valor es la primera acción EXITOSA (una venta, un producto, un
 * movimiento que quedó escrito), no el primer mensaje: conversar sin que nada
 * quede registrado no le resolvió nada a nadie. Medido una sola vez antes del
 * piloto: ~25 minutos en la única cuenta que llegó, y de 5 altas desde agosto
 * solo 1 llegó a una acción el primer día.
 *
 * El plan del piloto pide tratar a toda cuenta que pasa 24 h sin llegar como
 * una ALERTA A INTERVENIR a mano (un WhatsApp, una llamada), no como un dato
 * pasivo. Por eso el chequeo lista esas cuentas por su id.
 *
 * Es informativo: que alguien no haya cargado nada todavía es una tarea para
 * una persona, no un sistema caído, y no tiene que poner rojo el monitor.
 */

export type FilaPrimerValor = {
  usuario_id: string;
  registro: string | null;
  primera_accion_ok: string | null;
};

/** Cuántos días hacia atrás cuenta como "cuenta nueva". */
export const DIAS_CUENTA_NUEVA = 14;
/** Pasado esto sin una acción, hay que intervenir. */
export const HORAS_ALERTA = 24;

const HORA = 3_600_000;

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

function duracion(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = ms / HORA;
  return h < 48 ? `${h.toFixed(1).replace(".", ",")} h` : `${Math.round(h / 24)} días`;
}

export function evaluarPrimerValor(
  filas: FilaPrimerValor[],
  ahora: number = Date.now(),
): { detalle: string; sinValor: string[] } {
  const nuevas = filas.filter((f) => {
    const r = f.registro ? Date.parse(f.registro) : NaN;
    return Number.isFinite(r) && ahora - r <= DIAS_CUENTA_NUEVA * 24 * HORA;
  });

  if (nuevas.length === 0) {
    return { detalle: `ninguna cuenta real nueva en ${DIAS_CUENTA_NUEVA} días`, sinValor: [] };
  }

  const tiempos: number[] = [];
  const primerDia: number[] = [];
  const sinValor: string[] = [];

  for (const f of nuevas) {
    const registro = Date.parse(f.registro as string);
    const accion = f.primera_accion_ok ? Date.parse(f.primera_accion_ok) : NaN;

    if (Number.isFinite(accion)) {
      const t = Math.max(0, accion - registro);
      tiempos.push(t);
      if (t <= HORAS_ALERTA * HORA) primerDia.push(t);
    } else if (ahora - registro > HORAS_ALERTA * HORA) {
      sinValor.push(f.usuario_id);
    }
  }

  const m = mediana(tiempos);
  const partes = [
    `${nuevas.length} cuenta(s) real(es) nueva(s) en ${DIAS_CUENTA_NUEVA} días`,
    `${primerDia.length} llegaron a una acción el primer día`,
    m === null ? "ninguna llegó todavía a una acción" : `mediana al primer valor: ${duracion(m)}`,
  ];

  if (sinValor.length > 0) {
    partes.push(
      `INTERVENIR (más de ${HORAS_ALERTA} h sin una acción): ` +
        sinValor.map((id) => id.slice(0, 8)).join(", "),
    );
  }

  return { detalle: partes.join(" · "), sinValor };
}
