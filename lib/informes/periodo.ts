/**
 * De "mi balance semanal" a dos fechas concretas.
 *
 * Suena trivial y no lo es: "semanal" puede ser los últimos siete días o la
 * semana que va corriendo, y son informes distintos. Un martes, "los últimos
 * 7 días" arrastra el fin de semana anterior; "esta semana" son dos días. Si
 * EOS elige mal, el usuario ve un total que no reconoce y deja de creerle al
 * archivo entero.
 *
 * La regla acá: **el período que se nombra es el que se muestra en el título**.
 * El informe siempre dice de qué al qué, con todas las letras, para que el
 * número nunca quede sin su contexto.
 *
 * Todo es aritmética sobre cadenas `YYYY-MM-DD`. No se usa `new Date` para
 * nada que después se muestre: en UTC-3 una fecha ISO parseada así se corre un
 * día para atrás, y un balance semanal corrido un día es un balance mal.
 */

export type ClavePeriodo =
  | "semana"
  | "semana_pasada"
  | "mes"
  | "mes_pasado"
  | "trimestre"
  | "anio"
  | "personalizado";

export type Periodo = {
  clave: ClavePeriodo;
  /** Inclusive. */
  desde: string;
  /** Inclusive. */
  hasta: string;
  /** "del 17 al 23 de agosto de 2026". Va en el título del archivo. */
  etiqueta: string;
};

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const CLAVES: ClavePeriodo[] = [
  "semana",
  "semana_pasada",
  "mes",
  "mes_pasado",
  "trimestre",
  "anio",
  "personalizado",
];

export function esClavePeriodo(valor: string): valor is ClavePeriodo {
  return (CLAVES as string[]).includes(valor);
}

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [a, m, d];
}

function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = partes(fecha);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** Lunes = 0. La semana paraguaya empieza el lunes, no el domingo. */
function diaDeSemana(fecha: string): number {
  const [a, m, d] = partes(fecha);
  return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Cómo se nombra un tramo de fechas en castellano, sin repetir lo que no hace
 * falta: "del 17 al 23 de agosto de 2026", no "del 17 de agosto de 2026 al 23
 * de agosto de 2026".
 */
export function etiquetarTramo(desde: string, hasta: string): string {
  const [a1, m1, d1] = partes(desde);
  const [a2, m2, d2] = partes(hasta);

  if (desde === hasta) return `${d1} de ${MESES[m1 - 1]} de ${a1}`;

  // Mes entero completo: se nombra el mes, que es como lo diría cualquiera.
  if (a1 === a2 && m1 === m2 && d1 === 1 && d2 === ultimoDiaDelMes(a2, m2)) {
    return `${MESES[m1 - 1]} de ${a1}`;
  }

  if (a1 === a2 && m1 === m2) return `del ${d1} al ${d2} de ${MESES[m1 - 1]} de ${a1}`;
  if (a1 === a2) return `del ${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]} de ${a1}`;

  return `del ${d1} de ${MESES[m1 - 1]} de ${a1} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}

/**
 * Resuelve el período pedido contra el día de hoy.
 *
 * Los períodos "en curso" (semana, mes, trimestre, año) terminan HOY y no el
 * domingo o el 31: un balance que promete el mes y devuelve días que todavía
 * no ocurrieron muestra ceros donde va a haber gastos, y el usuario lo lee
 * como que gastó de menos.
 */
export function resolverPeriodo(
  clave: ClavePeriodo,
  hoy: string,
  personalizado?: { desde?: string; hasta?: string },
): Periodo {
  const [anio, mes] = partes(hoy);

  const armar = (desde: string, hasta: string): Periodo => ({
    clave,
    desde,
    hasta,
    etiqueta: etiquetarTramo(desde, hasta),
  });

  switch (clave) {
    case "semana": {
      const lunes = sumarDias(hoy, -diaDeSemana(hoy));
      return armar(lunes, hoy);
    }

    case "semana_pasada": {
      const lunesEsta = sumarDias(hoy, -diaDeSemana(hoy));
      // La semana pasada sí va completa: ya terminó, no hay futuro que mostrar.
      return armar(sumarDias(lunesEsta, -7), sumarDias(lunesEsta, -1));
    }

    case "mes":
      return armar(iso(anio, mes, 1), hoy);

    case "mes_pasado": {
      const anioPrevio = mes === 1 ? anio - 1 : anio;
      const mesPrevio = mes === 1 ? 12 : mes - 1;
      return armar(
        iso(anioPrevio, mesPrevio, 1),
        iso(anioPrevio, mesPrevio, ultimoDiaDelMes(anioPrevio, mesPrevio)),
      );
    }

    case "trimestre": {
      // Trimestre calendario, no "los últimos tres meses": es el que le sirve
      // a un contador, y es el que el usuario va a poder cotejar con otra cosa.
      const primerMes = Math.floor((mes - 1) / 3) * 3 + 1;
      return armar(iso(anio, primerMes, 1), hoy);
    }

    case "anio":
      return armar(iso(anio, 1, 1), hoy);

    case "personalizado": {
      const desde = normalizarFecha(personalizado?.desde) ?? iso(anio, mes, 1);
      const hasta = normalizarFecha(personalizado?.hasta) ?? hoy;
      // Al revés se corrige en vez de fallar: quien escribe las fechas dadas
      // vuelta quiere el tramo entre ellas, no un error.
      return desde <= hasta ? armar(desde, hasta) : armar(hasta, desde);
    }
  }
}

/** `YYYY-MM-DD` real, o `null`. No acepta "2026-13-45". */
export function normalizarFecha(valor: string | null | undefined): string | null {
  if (!valor) return null;

  const limpio = valor.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return null;

  const [a, m, d] = partes(limpio);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > ultimoDiaDelMes(a, m)) return null;

  return limpio;
}
