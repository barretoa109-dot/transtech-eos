/**
 * La lógica del calendario que no depende de la base ni de la pantalla.
 *
 * ============================================================
 * POR QUÉ ESTÁ APARTE
 * ============================================================
 *
 * El calendario tiene dos cuentas donde un error se ve razonable: qué días
 * muestra la grilla del mes, y qué cuenta como "atrasado". Si la grilla se
 * arma con `new Date()` en la zona del servidor, alguien en Asunción ve el
 * último día del mes corrido una fecha a las 21:00. Si "atrasado" lo decide
 * cada pantalla, la lista y el resumen dejan de coincidir.
 *
 * Todo se hace con cadenas `YYYY-MM-DD` y aritmética en UTC, la misma
 * convención que `lib/fecha.ts`: la fecha de un evento es un día del
 * calendario, no un instante, y no tiene zona horaria.
 */

import { ZONA_PARAGUAY, hoyEnParaguay } from "../fecha.ts";

export type CategoriaAgenda =
  | "agenda"
  | "recordatorio"
  | "actividad"
  | "seguimiento"
  | "trabajo"
  | "cobro"
  | "pago"
  | "meta";

/** Las que la persona puede crear a mano. El resto se lee de otros módulos. */
export const CATEGORIAS_PROPIAS = [
  "agenda",
  "recordatorio",
  "actividad",
  "seguimiento",
  "trabajo",
] as const;

export type CategoriaPropia = (typeof CATEGORIAS_PROPIAS)[number];

export type OrigenAgenda = "propio" | "tareas" | "crm" | "erp" | "metas" | "finanzas";

export type EstadoAgenda = "pendiente" | "hecho" | "cancelado";

export type EventoAgenda = {
  /** Único entre orígenes: `<origen>:<id>`. */
  id: string;
  origen: OrigenAgenda;
  categoria: CategoriaAgenda;
  titulo: string;
  detalle: string | null;
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** `HH:MM`, o null si es de todo el día. */
  hora: string | null;
  hora_fin: string | null;
  estado: EstadoAgenda;
  contacto: string | null;
  monto: number | null;
  moneda: string | null;
  /** Los que la persona anotó a mano, o que EOS anotó por ella desde el chat. */
  editable: boolean;
  /** Se puede marcar como hecho desde el calendario. */
  completable: boolean;
};

export const ETIQUETAS: Record<CategoriaAgenda, string> = {
  agenda: "Agenda",
  recordatorio: "Recordatorio",
  actividad: "Actividad",
  seguimiento: "Seguimiento",
  trabajo: "Trabajo realizado",
  cobro: "Cobro",
  pago: "Pago",
  meta: "Meta",
};

const ORDEN_CATEGORIA: Record<CategoriaAgenda, number> = {
  agenda: 0,
  recordatorio: 1,
  seguimiento: 2,
  actividad: 3,
  cobro: 4,
  pago: 5,
  meta: 6,
  trabajo: 7,
};

/**
 * Paraguay está en UTC-3 todo el año desde 2024, así que un instante se arma y
 * se lee con ese desfase fijo. Es la misma suposición que hace `fuentes.ts` al
 * consultar por rango.
 */
const DESFASE_PARAGUAY = "-03:00";

/**
 * De un instante de la base (`timestamptz`) al día y la hora que ve la persona.
 *
 * Las tareas del chat guardan su fecha límite como un instante. Hay dos
 * maneras en que llegó ahí, y las dos se leen bien:
 *
 *   · El ejecutor actual guarda la hora de Paraguay: "el 25" es las 00:00 del 25
 *     en Asunción (03:00 UTC). Las 00:00 locales significan "todo el día".
 *   · Antes de la v188 una fecha AAAA-MM-DD entraba como MEDIANOCHE UTC, que en
 *     Paraguay son las 21:00 del día anterior. Leerla con la zona de Asunción
 *     mostraría "el 24" para algo que la persona pidió el 25. Medianoche UTC
 *     exacta no la produce ninguna persona real (nadie agenda a las 21:00 del día
 *     anterior con segundos en cero justo ahí), así que se lee como fecha sin
 *     hora.
 */
export function instanteAAgenda(valor: unknown): { fecha: string; hora: string | null } | null {
  if (typeof valor !== "string") return null;

  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;

  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return { fecha: d.toISOString().slice(0, 10), hora: null };
  }

  const fecha = hoyEnParaguay(d);
  const hora = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA_PARAGUAY,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);

  return { fecha, hora: hora === "00:00" ? null : hora };
}

/** Lo contrario: el día y la hora del formulario, al instante que se guarda. */
export function agendaAInstante(fecha: string, hora: string | null): string {
  return `${fecha}T${hora ?? "00:00"}:00${DESFASE_PARAGUAY}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ¿Es una fecha `YYYY-MM-DD` que existe? (`2026-02-30` no.) */
export function esFechaValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !ISO.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** `HH:MM` de 24 horas. Acepta `HH:MM:SS` (lo que devuelve Postgres). */
export function normalizarHora(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const corta = valor.slice(0, 5);
  return HORA.test(corta) ? corta : null;
}

export function sumarDiasISO(iso: string, dias: number): string {
  const base = Date.parse(`${iso}T00:00:00Z`);
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Los 42 días (6 semanas) que dibuja la grilla de un mes, de lunes a domingo.
 *
 * Siempre seis filas y no las que "hagan falta": una grilla que cambia de alto
 * entre febrero y mayo hace saltar todo lo que está debajo cada vez que se
 * pasa de mes.
 *
 * `mes` va de 1 a 12, como se lee, no de 0 a 11 como en `Date`.
 */
export function diasDeGrilla(anio: number, mes: number): string[] {
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  // getUTCDay: 0 = domingo. Se corre para que el lunes sea 0.
  const desfase = (primero.getUTCDay() + 6) % 7;
  const inicio = primero.toISOString().slice(0, 10);
  const arranque = sumarDiasISO(inicio, -desfase);

  return Array.from({ length: 42 }, (_, i) => sumarDiasISO(arranque, i));
}

/** El mes (`{ anio, mes }`) al que pertenece una fecha ISO. */
export function mesDe(iso: string): { anio: number; mes: number } {
  return { anio: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) };
}

/** El mes anterior (`delta` -1) o siguiente (`delta` 1). */
export function moverMes(anio: number, mes: number, delta: number): { anio: number; mes: number } {
  const d = new Date(Date.UTC(anio, mes - 1 + delta, 1));
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

/**
 * Dentro del día: lo de todo el día primero, después por hora, y a igual hora
 * por categoría. Un orden estable, porque una lista que se reacomoda sola al
 * refrescar parece un error.
 */
export function compararEventos(a: EventoAgenda, b: EventoAgenda): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;

  if (a.hora !== b.hora) {
    if (a.hora === null) return -1;
    if (b.hora === null) return 1;
    return a.hora < b.hora ? -1 : 1;
  }

  const porCategoria = ORDEN_CATEGORIA[a.categoria] - ORDEN_CATEGORIA[b.categoria];
  if (porCategoria !== 0) return porCategoria;

  return a.titulo.localeCompare(b.titulo, "es");
}

export function agruparPorDia(eventos: EventoAgenda[]): Map<string, EventoAgenda[]> {
  const porDia = new Map<string, EventoAgenda[]>();

  for (const e of [...eventos].sort(compararEventos)) {
    const lista = porDia.get(e.fecha);
    if (lista) lista.push(e);
    else porDia.set(e.fecha, [e]);
  }

  return porDia;
}

/**
 * Atrasado: quedó pendiente y su día ya pasó.
 *
 * Un evento de HOY nunca está atrasado aunque su hora haya pasado: la persona
 * todavía puede cumplirlo o marcarlo, y avisarle "atrasado" a las 15:01 de una
 * reunión de las 15:00 que está ocurriendo sería mentirle.
 */
export function estaAtrasado(e: Pick<EventoAgenda, "estado" | "fecha">, hoy: string): boolean {
  return e.estado === "pendiente" && e.fecha < hoy;
}

export type ResumenAgenda = {
  atrasados: number;
  hoy: number;
  proximos7: number;
};

/**
 * Las tres cifras de arriba del calendario.
 *
 * `proximos7` cuenta de mañana a 7 días: lo de hoy ya está en su propia cifra
 * y contarlo dos veces haría que "hoy: 3, próximos 7 días: 5" pareciera 5
 * cosas más cuando son 2.
 */
export function resumir(eventos: EventoAgenda[], hoy: string): ResumenAgenda {
  const limite = sumarDiasISO(hoy, 7);
  const vistos = new Set<string>();
  const resumen: ResumenAgenda = { atrasados: 0, hoy: 0, proximos7: 0 };

  for (const e of eventos) {
    // Lo cancelado no es trabajo pendiente y lo hecho ya no espera nada: solo
    // cuentan las cosas por hacer.
    if (e.estado !== "pendiente" || vistos.has(e.id)) continue;
    vistos.add(e.id);

    if (e.fecha < hoy) resumen.atrasados += 1;
    else if (e.fecha === hoy) resumen.hoy += 1;
    else if (e.fecha <= limite) resumen.proximos7 += 1;
  }

  return resumen;
}

export type EventoPropioEntrada = {
  titulo: string;
  detalle: string | null;
  categoria: CategoriaPropia;
  fecha: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  contacto_nombre: string | null;
};

/**
 * Valida lo que llega del formulario. Devuelve el error en castellano, listo
 * para mostrar, o los datos ya limpios.
 *
 * Se valida acá y no solo en la base porque los CHECK de Postgres contestan
 * con un mensaje técnico, y la persona tiene que leer qué corregir, no
 * `violates check constraint "eos_calendario_hora_fin_check"`.
 */
export function validarEventoPropio(
  cuerpo: Record<string, unknown>,
): { ok: true; datos: EventoPropioEntrada } | { ok: false; error: string } {
  const titulo = String(cuerpo.titulo ?? "").trim().slice(0, 200);
  if (!titulo) return { ok: false, error: "Escribí un título." };

  if (!esFechaValida(cuerpo.fecha)) return { ok: false, error: "Elegí una fecha válida." };

  const categoria = CATEGORIAS_PROPIAS.includes(cuerpo.categoria as CategoriaPropia)
    ? (cuerpo.categoria as CategoriaPropia)
    : "actividad";

  const horaInicio = cuerpo.hora_inicio ? normalizarHora(cuerpo.hora_inicio) : null;
  const horaFin = cuerpo.hora_fin ? normalizarHora(cuerpo.hora_fin) : null;

  if (cuerpo.hora_inicio && !horaInicio) return { ok: false, error: "La hora de inicio no es válida." };
  if (cuerpo.hora_fin && !horaFin) return { ok: false, error: "La hora de fin no es válida." };
  if (horaFin && !horaInicio) return { ok: false, error: "Para poner hora de fin, poné también la de inicio." };
  if (horaInicio && horaFin && horaFin < horaInicio) {
    return { ok: false, error: "La hora de fin es anterior a la de inicio." };
  }

  const detalle = String(cuerpo.detalle ?? "").trim().slice(0, 4000) || null;
  const contacto = String(cuerpo.contacto_nombre ?? "").trim().slice(0, 160) || null;

  return {
    ok: true,
    datos: {
      titulo,
      detalle,
      categoria,
      fecha: cuerpo.fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      contacto_nombre: contacto,
    },
  };
}
