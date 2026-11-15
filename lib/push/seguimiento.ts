import { hoyEnParaguay, sumarDias } from "../fecha.ts";

/**
 * El seguimiento que EOS le hace a cada persona: rachas y resumen de la semana.
 *
 * ============================================================
 * QUÉ BUSCA, Y QUÉ NO SE PERMITE
 * ============================================================
 *
 * Lo que hace que alguien vuelva no es que lo reten: es ver que lo que hizo
 * cuenta. Por eso todo lo de acá sale de lo que la persona HIZO —días en que
 * anotó algo— y nunca de una frase de ánimo genérica. Reglas de estos textos:
 *
 *   · Se festeja lo hecho con un número real (3 días, 7 días), no con adjetivos.
 *   · Lo que falta se dice como el paso más chico posible ("una frase alcanza").
 *   · Nunca culpa. Una semana sin anotar es "semana nueva", no "abandonaste".
 *   · Nada que no sea cierto: no se compara con "otros usuarios" ni se promete
 *     un resultado. Si no hay dato, no hay aviso de racha.
 *   · Sin montos ni nombres: se lee con el teléfono bloqueado.
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
    // cortara el texto de la fecha, cada noche rompería la racha de alguien.
    dias.add(hoyEnParaguay(instante));
  }
  return dias;
}

/** Cuántos días seguidos hay terminando en `hasta` (0 si ese día no hubo nada). */
export function rachaHasta(dias: Set<string>, hasta: string): number {
  let cuenta = 0;
  let dia = hasta;
  while (dias.has(dia) && cuenta < 400) {
    cuenta += 1;
    dia = sumarDias(dia, -1);
  }
  return cuenta;
}

/**
 * Las rachas que se festejan. No todos los días: un "¡4 días!" después de un
 * "¡3 días!" convierte un logro en ruido, y lo que se festeja siempre deja de
 * sentirse como un logro.
 */
export const HITOS_DE_RACHA = [3, 7, 14, 21, 30, 60, 90, 180, 365];

/** El festejo de una racha, o null si ese número no es un hito. */
export function avisoDeRacha(racha: number): AvisoSeguimiento | null {
  if (!HITOS_DE_RACHA.includes(racha)) return null;

  switch (racha) {
    case 3:
      return { titulo: "Tres días seguidos", cuerpo: "Tres días al hilo anotando con EOS. Así empieza un hábito: sin esfuerzo, una frase por vez." };
    case 7:
      return { titulo: "Una semana entera", cuerpo: "Siete días seguidos. Ya tenés una semana completa de tus números a la vista, sin huecos." };
    case 14:
      return { titulo: "Dos semanas sin cortar", cuerpo: "Catorce días seguidos. A esta altura ya no es fuerza de voluntad: es costumbre." };
    case 30:
      return { titulo: "Un mes entero", cuerpo: "Treinta días seguidos. Tenés un mes completo de números reales para decidir, no de memoria." };
    case 365:
      return { titulo: "Un año seguido", cuerpo: "Un año entero sin cortar. Hoy conocés tu plata mejor que nunca, y eso lo hiciste vos." };
    default:
      return { titulo: `${racha} días seguidos`, cuerpo: "Seguís sin cortar la racha. Lo que venís anotando ya trabaja para vos cada vez que decidís algo." };
  }
}

/** A partir de cuántos días vale la pena avisar que la racha se puede cortar. */
export const RACHA_QUE_VALE_CUIDAR = 3;

/**
 * La racha que se corta esta noche si hoy no se anota nada, o null.
 *
 * Es el único aviso que nombra una pérdida, así que se usa con cuidado: solo
 * si hay una racha de verdad (3 días o más) y solo a la noche, cuando todavía
 * se puede hacer algo. Dice cuánto lleva y qué alcanza para sostenerla.
 */
export function avisoRachaEnRiesgo(dias: Set<string>, hoy: string): AvisoSeguimiento | null {
  if (dias.has(hoy)) return null;

  const hastaAyer = rachaHasta(dias, sumarDias(hoy, -1));
  if (hastaAyer < RACHA_QUE_VALE_CUIDAR) return null;

  return {
    titulo: `Llevás ${hastaAyer} días seguidos`,
    cuerpo: "Hoy todavía no anotaste nada. Una frase alcanza para sostener la racha: lo último que gastaste o vendiste.",
  };
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
