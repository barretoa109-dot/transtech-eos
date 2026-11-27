import { hoyEnParaguay, sumarDias } from "../fecha.ts";

/**
 * El seguimiento que EOS le hace a cada persona: el resumen de la semana.
 *
 * ============================================================
 * QUÉ BUSCA, Y QUÉ NO SE PERMITE
 * ============================================================
 *
 * Lo que hace que alguien vuelva no es que lo reten: es ver que lo que hizo
 * cuenta. Por eso todo lo de acá sale de lo que la persona HIZO —días en que
 * anotó algo— y nunca de una frase de ánimo genérica. Reglas de estos textos:
 *
 *   · Lo hecho se dice con un número real, no con adjetivos.
 *   · Lo que falta se dice como el paso más chico posible ("una frase alcanza").
 *   · Nunca culpa. Una semana sin anotar es "semana nueva", no "abandonaste".
 *   · Nada que no sea cierto: no se compara con "otros usuarios" ni se promete
 *     un resultado.
 *   · Sin montos ni nombres: se lee con el teléfono bloqueado.
 *
 * ============================================================
 * POR QUÉ YA NO HAY RACHAS
 * ============================================================
 *
 * Hasta el 27/11/2026 este archivo festejaba rachas ("7 días seguidos") y a
 * la noche avisaba "tu racha está en riesgo". La regla 4 de los agentes de
 * EOS (docs/agentes/, aprobada por el dueño) prohíbe explícitamente las
 * rachas: una racha vale por no cortarla, no por lo que la persona sabe de su
 * plata, y el aviso de la noche funciona con la pérdida. Se sacaron las dos.
 * Queda el resumen del lunes, que cuenta días de la semana sin pedir que sean
 * seguidos.
 *
 * Todo este archivo es puro (recibe los días, devuelve el texto). La lectura
 * de la base está en `motivacionales.ts`.
 */

export type AvisoSeguimiento = { titulo: string; cuerpo: string };

/** Los días (en Paraguay) en que hubo al menos una acción, a partir de sus marcas de tiempo. */
export function diasActivos(marcas: (string | null | undefined)[]): Set<string> {
  const dias = new Set<string>();
  for (const marca of marcas) {
    if (!marca) continue;
    const instante = new Date(marca);
    if (Number.isNaN(instante.getTime())) continue;
    // Una venta anotada a las 22:00 de Asunción ya es "mañana" en UTC: si se
    // cortara el texto de la fecha, contaría en el día equivocado.
    dias.add(hoyEnParaguay(instante));
  }
  return dias;
}

/** En cuántos de los 7 días ANTERIORES a `hoy` hubo actividad. */
export function diasActivosEnLaSemana(dias: Set<string>, hoy: string): number {
  let cuenta = 0;
  for (let i = 1; i <= 7; i += 1) {
    if (dias.has(sumarDias(hoy, -i))) cuenta += 1;
  }
  return cuenta;
}

/** ¿`hoy` (AAAA-MM-DD) es lunes? */
export function esLunes(hoy: string): boolean {
  const [anio, mes, dia] = hoy.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay() === 1;
}

/**
 * El resumen del lunes: cómo fue la semana que pasó, y un paso para esta.
 *
 * Siempre termina mirando para adelante. Una semana floja no se señala: se
 * ofrece empezar de nuevo, que es lo único que la persona puede hacer con ella.
 */
export function avisoSemanal(activos: number): AvisoSeguimiento {
  if (activos >= 7) {
    return { titulo: "Semana completa", cuerpo: "Anotaste los 7 días de la semana pasada. Arrancás este lunes sabiendo exactamente dónde estás parado." };
  }
  if (activos >= 5) {
    return { titulo: "Gran semana", cuerpo: `Anotaste en ${activos} de los últimos 7 días. Con eso ya se decide con datos y no de memoria.` };
  }
  if (activos >= 2) {
    return { titulo: "Tu semana con EOS", cuerpo: `Anotaste en ${activos} de los últimos 7 días. Esta semana probá sumar uno más: es una frase por día.` };
  }
  if (activos === 1) {
    return { titulo: "Una semana para retomar", cuerpo: "La semana pasada anotaste un día. Empezá hoy con una frase y esta ya arranca mejor." };
  }
  return { titulo: "Semana nueva, cuenta nueva", cuerpo: "Lo que quedó sin anotar no importa. Contale a EOS lo de hoy y seguimos desde acá." };
}
