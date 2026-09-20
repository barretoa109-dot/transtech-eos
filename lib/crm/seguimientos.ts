/**
 * Qué clientes hay que retomar hoy, y por qué.
 *
 * ============================================================
 * EL CRM ACTIVO, NO PASIVO
 * ============================================================
 *
 * Un CRM pasivo es una agenda: guarda lo que le cargás. Este mira lo que ya pasó —
 * los mensajes, las actividades, las fechas— y le dice a la persona lo que se le está
 * escapando, en una frase concreta y con una acción lista:
 *
 *   "Hace 5 días que Carlos no responde a la propuesta de Gs. 3.500.000.
 *    Recomiendo hacer seguimiento hoy."
 *
 * ============================================================
 * QUÉ DETECTA
 * ============================================================
 *
 *   vencido / vence_hoy  Un seguimiento que la persona misma se puso (la próxima
 *                        interacción del cliente, una tarea, el próximo paso de una
 *                        oportunidad) y ya toca o ya pasó.
 *   sin_respuesta        Le escribimos por WhatsApp y no contestó. Si tiene una
 *                        propuesta abierta, dice cuál y de cuánto.
 *   estancada            Una oportunidad abierta sin ninguna novedad hace días.
 *   lead_sin_contactar   Alguien que escribió (o que se cargó como prospecto) y a quien
 *                        nadie le contestó todavía.
 *   cierre_proximo       Una oportunidad con fecha de cierre estimada que se acerca o ya
 *                        pasó, y todavía no se cerró.
 *
 * ============================================================
 * LAS REGLAS QUE EVITAN EL RUIDO
 * ============================================================
 *
 * Una lista de "cosas que hacer" que siempre está llena se deja de leer. Por eso:
 *
 *   · UN aviso por cliente: el más urgente. Si Carlos está vencido y además sin
 *     respuesta, es un solo renglón (el más grave), no dos.
 *   · Cada aviso tiene una CLAVE que incluye lo que lo originó (la fecha del último
 *     mensaje, la fecha del seguimiento). Si la persona lo resuelve, o EOS le escribe,
 *     la clave cambia y el aviso no vuelve; si pasa algo nuevo, es otro aviso.
 *   · Lo que la persona marcó hecho, posponió o descartó se recuerda.
 *   · Nunca se inventa: sin fecha, sin mensaje o sin monto, la frase lo omite en vez de
 *     rellenarlo.
 *
 * Todo es puro: no lee la base ni el reloj. Quien lo llama trae los datos.
 */

import { esFechaISOValida, sumarDias } from "../fecha.ts";
import { formatearMonto } from "../finanzas/formato.ts";

// ---------------------------------------------------------------------- entradas

export type ContactoEntrada = {
  id: string;
  nombre: string;
  estado_relacion?: string | null;
  proxima_interaccion_en?: string | null;
  creado_en?: string | null;
  activo?: boolean;
};

export type OportunidadEntrada = {
  id: string;
  contacto_id: string | null;
  titulo: string;
  monto: number;
  moneda: string;
  etapa: string;
  cierre_estimado?: string | null;
  proxima_accion_en?: string | null;
  actualizado_en?: string | null;
  creado_en?: string | null;
};

export type ActividadEntrada = {
  contacto_id: string | null;
  oportunidad_id?: string | null;
  tipo: string;
  fecha: string;
  hecha: boolean;
  detalle?: string | null;
};

export type MensajeEntrada = {
  contacto_id: string | null;
  direccion: "entrante" | "saliente";
  estado: string;
  ocurrio_en: string;
};

export type EstadoGuardado = { clave: string; estado: "hecho" | "pospuesto" | "descartado"; hasta: string | null };

export type EntradaSeguimientos = {
  /** AAAA-MM-DD, hora de Paraguay. */
  hoy: string;
  contactos: ContactoEntrada[];
  /** Solo las abiertas (ni ganadas ni perdidas). */
  oportunidades: OportunidadEntrada[];
  actividades: ActividadEntrada[];
  mensajes: MensajeEntrada[];
  estados: EstadoGuardado[];
  /** Los clientes a quienes se les puede escribir AHORA por el canal de la empresa. */
  puedenRecibir: Set<string>;
};

export type TipoSeguimiento = "vencido" | "vence_hoy" | "sin_respuesta" | "estancada" | "lead_sin_contactar" | "cierre_proximo";

export type Seguimiento = {
  /** Estable mientras el motivo sea el mismo: es lo que se recuerda al marcarlo hecho o posponerlo. */
  clave: string;
  tipo: TipoSeguimiento;
  /** 1 = hoy y con plata en juego; 2 = importante; 3 = para no olvidar. */
  prioridad: 1 | 2 | 3;
  contacto_id: string | null;
  contacto_nombre: string;
  oportunidad_id: string | null;
  /** Lo que pasó, en una frase. */
  texto: string;
  /** Qué conviene hacer, en una frase. */
  recomendacion: string;
  accion: "escribir" | "llamar" | "revisar";
  /** ¿Se le puede mandar un WhatsApp ahora mismo desde EOS? */
  puede_escribir: boolean;
  /** Un mensaje listo para revisar y mandar. Solo si la acción es escribir. */
  borrador: string | null;
  dias: number;
  monto: { valor: number; moneda: string } | null;
};

// ----------------------------------------------------------------------- umbrales

/** Días sin respuesta a un mensaje nuestro para avisar. Tres: menos es insistir. */
export const DIAS_SIN_RESPUESTA = 3;
/** Días sin ninguna novedad para llamar estancada a una oportunidad. Igual que el aviso del panel. */
export const DIAS_ESTANCADA = 14;
/** Días sin contestarle a un prospecto para avisar. Uno: un lead que espera se enfría rápido. */
export const DIAS_LEAD = 1;
/** Con cuántos días de anticipación se avisa de un cierre estimado. */
export const DIAS_CIERRE = 7;
/** Cuántos avisos se devuelven: una lista de cuarenta no se lee. */
export const MAX_SEGUIMIENTOS = 20;

const ENVIADO = new Set(["en_cola", "enviado", "entregado", "leido"]);
const ETAPAS_CON_PROPUESTA = new Set(["propuesta", "negociacion"]);
const CONTACTOS_NUESTROS = new Set(["llamada", "reunion", "correo", "whatsapp"]);

function dias(desde: string, hasta: string): number {
  const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);
const cuantosDias = (n: number) => (n === 1 ? "1 día" : `${n} días`);

function diaMes(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

const fechaOk = (v: string | null | undefined): v is string => typeof v === "string" && esFechaISOValida(v.slice(0, 10));

// ---------------------------------------------------------------------- el borrador

/** Un mensaje razonable para arrancar: la persona lo revisa antes de mandarlo. */
function borradorPara(tipo: TipoSeguimiento, nombre: string, oportunidad: OportunidadEntrada | null): string {
  const primero = nombre.trim().split(/\s+/)[0] || nombre;

  switch (tipo) {
    case "sin_respuesta":
      return oportunidad && ETAPAS_CON_PROPUESTA.has(oportunidad.etapa)
        ? `Hola ${primero}, ¿pudiste ver la propuesta que te pasé? Quedo atento a cualquier duda.`
        : `Hola ${primero}, ¿pudiste ver mi mensaje? Quedo atento.`;
    case "lead_sin_contactar":
      return `Hola ${primero}, gracias por escribirnos. ¿En qué te puedo ayudar?`;
    case "cierre_proximo":
      return `Hola ${primero}, ¿cómo venís con lo que hablamos? Quería saber si podemos avanzar esta semana.`;
    default:
      return `Hola ${primero}, ¿cómo estás? Te escribo para retomar lo que veníamos hablando.`;
  }
}

// ------------------------------------------------------------------------ el motor

export function calcularSeguimientos(e: EntradaSeguimientos): Seguimiento[] {
  const contactos = new Map(e.contactos.filter((c) => c.activo !== false).map((c) => [c.id, c]));
  const abiertas = e.oportunidades.filter((o) => o.etapa !== "ganada" && o.etapa !== "perdida");

  const opDe = (contactoId: string) =>
    // La más avanzada y de más monto: es la que más importa nombrar.
    abiertas
      .filter((o) => o.contacto_id === contactoId)
      .sort((a, b) => Number(ETAPAS_CON_PROPUESTA.has(b.etapa)) - Number(ETAPAS_CON_PROPUESTA.has(a.etapa)) || b.monto - a.monto)[0] ?? null;

  const candidatos: Seguimiento[] = [];

  const agregar = (s: Omit<Seguimiento, "puede_escribir" | "borrador"> & { op: OportunidadEntrada | null }) => {
    const { op, ...resto } = s;
    const puede = s.contacto_id !== null && e.puedenRecibir.has(s.contacto_id);
    candidatos.push({
      ...resto,
      puede_escribir: puede,
      borrador: s.accion === "escribir" ? borradorPara(s.tipo, s.contacto_nombre, op) : null,
    });
  };

  // ---- 1. Lo que la persona misma se puso: vencido o de hoy.
  type Compromiso = { fecha: string; contactoId: string | null; opId: string | null };
  const compromisos: Compromiso[] = [];

  for (const c of contactos.values()) {
    if (fechaOk(c.proxima_interaccion_en)) compromisos.push({ fecha: c.proxima_interaccion_en, contactoId: c.id, opId: null });
  }
  for (const o of abiertas) {
    if (fechaOk(o.proxima_accion_en)) compromisos.push({ fecha: o.proxima_accion_en, contactoId: o.contacto_id, opId: o.id });
  }
  for (const a of e.actividades) {
    if (a.tipo === "tarea" && !a.hecha && fechaOk(a.fecha)) compromisos.push({ fecha: a.fecha, contactoId: a.contacto_id, opId: a.oportunidad_id ?? null });
  }

  for (const c of compromisos) {
    if (!c.contactoId || !contactos.has(c.contactoId) || c.fecha > e.hoy) continue;

    const contacto = contactos.get(c.contactoId)!;
    const op = opDe(contacto.id);
    const atraso = dias(c.fecha, e.hoy);
    const conPlata = op !== null && op.monto > 0;

    agregar({
      clave: `${atraso === 0 ? "vence_hoy" : "vencido"}:${contacto.id}:${c.fecha}`,
      tipo: atraso === 0 ? "vence_hoy" : "vencido",
      prioridad: atraso === 0 || conPlata ? 1 : 2,
      contacto_id: contacto.id,
      contacto_nombre: contacto.nombre,
      oportunidad_id: op?.id ?? c.opId,
      texto:
        atraso === 0
          ? `Hoy tenías que retomar con ${contacto.nombre}.`
          : `Hace ${cuantosDias(atraso)} tenías que retomar con ${contacto.nombre}.`,
      recomendacion: "Escribile o llamalo hoy, o poné una nueva fecha si todavía no toca.",
      accion: "escribir",
      dias: atraso,
      monto: op ? { valor: op.monto, moneda: op.moneda } : null,
      op,
    });
  }

  // ---- 2. Le escribimos y no contestó.
  for (const c of contactos.values()) {
    const suyos = e.mensajes.filter((m) => m.contacto_id === c.id);
    const ultimoSaliente = suyos
      .filter((m) => m.direccion === "saliente" && ENVIADO.has(m.estado))
      .map((m) => m.ocurrio_en)
      .sort()
      .pop();
    if (!ultimoSaliente) continue;

    // Si contestó DESPUÉS de nuestro último mensaje, no está sin respuesta.
    const contesto = suyos.some((m) => m.direccion === "entrante" && Date.parse(m.ocurrio_en) > Date.parse(ultimoSaliente));
    if (contesto) continue;

    const espera = dias(ultimoSaliente, e.hoy);
    if (espera < DIAS_SIN_RESPUESTA) continue;

    const op = opDe(c.id);
    const propuesta = op !== null && ETAPAS_CON_PROPUESTA.has(op.etapa);

    agregar({
      clave: `sin_respuesta:${c.id}:${ultimoSaliente.slice(0, 10)}`,
      tipo: "sin_respuesta",
      prioridad: propuesta ? 1 : 2,
      contacto_id: c.id,
      contacto_nombre: c.nombre,
      oportunidad_id: op?.id ?? null,
      texto: propuesta && op.monto > 0
        ? `Hace ${cuantosDias(espera)} que ${c.nombre} no responde a la propuesta de ${formatearMonto(op.monto, op.moneda)}.`
        : propuesta
          ? `Hace ${cuantosDias(espera)} que ${c.nombre} no responde a la propuesta.`
          : `Hace ${cuantosDias(espera)} que le escribiste a ${c.nombre} y no respondió.`,
      recomendacion: "Recomiendo hacer seguimiento hoy.",
      accion: "escribir",
      dias: espera,
      monto: op ? { valor: op.monto, moneda: op.moneda } : null,
      op,
    });
  }

  // ---- 3. Una oportunidad estancada.
  for (const o of abiertas) {
    if (!o.contacto_id || !contactos.has(o.contacto_id)) continue;

    const c = contactos.get(o.contacto_id)!;
    const marcas = [
      o.actualizado_en,
      o.creado_en,
      ...e.actividades.filter((a) => a.contacto_id === c.id && a.hecha).map((a) => a.fecha),
      ...e.mensajes.filter((m) => m.contacto_id === c.id).map((m) => m.ocurrio_en),
    ].filter((m): m is string => typeof m === "string" && Number.isFinite(Date.parse(m)));

    if (marcas.length === 0) continue;

    const ultima = marcas.sort().pop()!;
    const quieta = dias(ultima, e.hoy);
    if (quieta < DIAS_ESTANCADA) continue;

    agregar({
      clave: `estancada:${o.id}:${ultima.slice(0, 10)}`,
      tipo: "estancada",
      prioridad: o.monto > 0 ? 2 : 3,
      contacto_id: c.id,
      contacto_nombre: c.nombre,
      oportunidad_id: o.id,
      texto:
        o.monto > 0
          ? `«${o.titulo}» (${formatearMonto(o.monto, o.moneda)}) lleva ${cuantosDias(quieta)} sin novedades.`
          : `«${o.titulo}» lleva ${cuantosDias(quieta)} sin novedades.`,
      recomendacion: "O se retoma esta semana o conviene darla por perdida para que el embudo no mienta.",
      accion: "escribir",
      dias: quieta,
      monto: { valor: o.monto, moneda: o.moneda },
      op: o,
    });
  }

  // ---- 4. Un lead al que nadie le contestó.
  for (const c of contactos.values()) {
    const suyos = e.mensajes.filter((m) => m.contacto_id === c.id);
    const entrantes = suyos.filter((m) => m.direccion === "entrante").map((m) => m.ocurrio_en).sort();
    const ultimoEntrante = entrantes.pop();
    const hayRespuestaNuestra = suyos.some((m) => m.direccion === "saliente" && ENVIADO.has(m.estado));
    const gestionado = e.actividades.some((a) => a.contacto_id === c.id && a.hecha && CONTACTOS_NUESTROS.has(a.tipo) && a.tipo !== "whatsapp");

    let espera: number | null = null;
    let desde: string | null = null;

    if (ultimoEntrante && !suyos.some((m) => m.direccion === "saliente" && ENVIADO.has(m.estado) && Date.parse(m.ocurrio_en) > Date.parse(ultimoEntrante)) && !gestionado) {
      // Escribió y nadie le contestó.
      espera = dias(ultimoEntrante, e.hoy);
      desde = ultimoEntrante.slice(0, 10);
    } else if (c.estado_relacion === "prospecto" && c.creado_en && !hayRespuestaNuestra && !gestionado) {
      // Un prospecto cargado y al que nunca se le habló.
      espera = dias(c.creado_en, e.hoy);
      desde = c.creado_en.slice(0, 10);
    }

    if (espera === null || desde === null || espera < DIAS_LEAD) continue;

    const op = opDe(c.id);
    agregar({
      clave: `lead:${c.id}:${desde}`,
      tipo: "lead_sin_contactar",
      prioridad: espera >= 2 ? 1 : 2,
      contacto_id: c.id,
      contacto_nombre: c.nombre,
      oportunidad_id: op?.id ?? null,
      texto: ultimoEntrante
        ? `${c.nombre} te escribió hace ${cuantosDias(espera)} y todavía nadie le contestó.`
        : `${c.nombre} entró como prospecto hace ${cuantosDias(espera)} y todavía no lo contactaste.`,
      recomendacion: "Un cliente potencial que espera se enfría rápido: contestale hoy.",
      accion: "escribir",
      dias: espera,
      monto: op ? { valor: op.monto, moneda: op.moneda } : null,
      op,
    });
  }

  // ---- 5. Un cierre estimado que se acerca o ya pasó.
  const limite = sumarDias(e.hoy, DIAS_CIERRE);
  const porMonto = [...abiertas].filter((o) => o.monto > 0).sort((a, b) => b.monto - a.monto);
  const top = new Set(porMonto.slice(0, 3).map((o) => o.id));

  for (const o of abiertas) {
    if (!fechaOk(o.cierre_estimado) || o.cierre_estimado > limite) continue;
    const c = o.contacto_id ? contactos.get(o.contacto_id) : undefined;
    const faltan = dias(e.hoy, o.cierre_estimado);

    agregar({
      clave: `cierre:${o.id}:${o.cierre_estimado}`,
      tipo: "cierre_proximo",
      prioridad: top.has(o.id) ? 1 : 3,
      contacto_id: c?.id ?? null,
      contacto_nombre: c?.nombre ?? "",
      oportunidad_id: o.id,
      texto:
        (o.monto > 0 ? `«${o.titulo}» (${formatearMonto(o.monto, o.moneda)}) ` : `«${o.titulo}» `) +
        (faltan < 0
          ? `tenía cierre estimado el ${diaMes(o.cierre_estimado)}, hace ${cuantosDias(-faltan)}, y sigue abierta.`
          : faltan === 0
            ? "tiene cierre estimado para hoy."
            : `tiene cierre estimado el ${diaMes(o.cierre_estimado)} (en ${cuantosDias(faltan)}).`),
      recomendacion: faltan < 0 ? "Ganala, perdela o poné una fecha nueva: así el pronóstico no cuenta plata vencida." : "Confirmá cómo viene para no llegar a la fecha sin saberlo.",
      accion: c ? "escribir" : "revisar",
      dias: Math.abs(faltan),
      monto: { valor: o.monto, moneda: o.moneda },
      op: o,
    });
  }

  // ---- Lo que la persona ya resolvió, pospuso o descartó.
  const estados = new Map(e.estados.map((s) => [s.clave, s]));
  const visibles = candidatos.filter((s) => {
    const g = estados.get(s.clave);
    if (!g) return true;
    if (g.estado === "pospuesto") return !g.hasta || g.hasta <= e.hoy;
    return false; // hecho o descartado
  });

  // ---- UN aviso por cliente: el más urgente. Los cierres (por oportunidad) van aparte.
  const orden = (a: Seguimiento, b: Seguimiento) =>
    a.prioridad - b.prioridad || (b.monto?.valor ?? 0) - (a.monto?.valor ?? 0) || b.dias - a.dias || a.clave.localeCompare(b.clave);

  const mejorPorCliente = new Map<string, Seguimiento>();
  const sinCliente: Seguimiento[] = [];

  for (const s of visibles.sort(orden)) {
    if (s.tipo === "cierre_proximo" || !s.contacto_id) {
      sinCliente.push(s);
      continue;
    }
    if (!mejorPorCliente.has(s.contacto_id)) mejorPorCliente.set(s.contacto_id, s);
  }

  // Un cierre de un cliente que YA tiene otro aviso más urgente no se repite: el cliente ya está en la lista.
  const yaEnLista = new Set(mejorPorCliente.keys());
  const cierres = sinCliente.filter((s) => !s.contacto_id || !yaEnLista.has(s.contacto_id));

  return [...mejorPorCliente.values(), ...cierres].sort(orden).slice(0, MAX_SEGUIMIENTOS);
}

/** El titular de la lista: una línea, para la pantalla y para el chat. */
export function titularDeSeguimientos(s: Seguimiento[]): string {
  if (s.length === 0) return "Nada para retomar hoy.";
  const urgentes = s.filter((x) => x.prioridad === 1).length;
  return urgentes > 0
    ? `${plural(s.length, "seguimiento", "seguimientos")}, ${urgentes === 1 ? "1 urgente" : `${urgentes} urgentes`}.`
    : `${plural(s.length, "seguimiento", "seguimientos")}.`;
}
