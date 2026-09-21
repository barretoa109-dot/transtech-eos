import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { filtroDeEmpresa } from "../empresa/acceso.ts";
import { SALDO_CERO } from "../erp/cartera.ts";
import { hoyEnParaguay, sumarDias } from "../fecha.ts";
import { leerPanoramaPersonal } from "../finanzas/leerCalendario.ts";
import {
  compararEventos,
  normalizarHora,
  type CategoriaAgenda,
  type CategoriaPropia,
  type EstadoAgenda,
  type EventoAgenda,
} from "./agenda.ts";

/**
 * De dónde sale cada cosa que muestra el calendario.
 *
 * ============================================================
 * SE LEE, NO SE COPIA
 * ============================================================
 *
 * El calendario no tiene una tabla propia con "todo lo que pasa". Cada evento
 * se lee de la tabla donde vive: la tarea del CRM, la factura que vence, la
 * meta con fecha límite. Copiarlos a una tabla de agenda los haría
 * desincronizarse el día que alguien marque la tarea como hecha desde el CRM y
 * el calendario la siga mostrando pendiente.
 *
 * La única tabla propia es `eos_calendario_eventos`, y guarda solo lo que la
 * persona anota a mano.
 *
 * ============================================================
 * CADA FUENTE PUEDE FALLAR SOLA
 * ============================================================
 *
 * Si una consulta falla, el calendario NO se cae ni muestra el mes como si esa
 * fuente estuviera vacía: `armarAgenda` anota cuál falló y la pantalla lo dice.
 * "No hay cobros esta semana" y "no pudimos leer los cobros" son cosas muy
 * distintas para quien planea su semana, y las dos se ven igual de vacías.
 */

export type ContextoAgenda = {
  usuarioId: string;
  empresaId: string | null;
  /** Cliente de sesión: la RLS protege lo que se lee con él. */
  supabase: ClienteSinTipos;
  /** Cliente de servicio, solo para lo que la RLS no deja leer (cobranzas). */
  admin: ClienteSinTipos;
  hoy: string;
  desde: string;
  hasta: string;
  modulos: { crm: boolean; erp: boolean; finanzas: boolean };
  /**
   * Trae solo lo que quedó por hacer. Es lo que arma la lista de atrasados: mirar
   * dos meses hacia atrás para encontrar cinco pendientes no debería cargar
   * también cada venta y cada nota del período.
   */
  soloPendientes?: boolean;
};

type Fila = Record<string, unknown>;

const LIMITE = 500;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function numero(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Primera línea, recortada: los títulos largos rompen la grilla. */
function titular(valor: string, max = 90): { titulo: string; resto: string | null } {
  const limpio = valor.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return { titulo: limpio, resto: null };
  return { titulo: `${limpio.slice(0, max - 1).trimEnd()}…`, resto: limpio };
}

function nombreDeContacto(fila: Fila): string | null {
  const c = fila.contacto as { nombre?: unknown } | null | undefined;
  return texto(c?.nombre);
}

function base(parcial: Partial<EventoAgenda> & Pick<EventoAgenda, "id" | "origen" | "categoria" | "titulo" | "fecha">): EventoAgenda {
  return {
    detalle: null,
    hora: null,
    hora_fin: null,
    estado: "pendiente",
    contacto: null,
    monto: null,
    moneda: null,
    editable: false,
    completable: false,
    ...parcial,
  };
}

function falla(fuente: string, error: unknown): never {
  console.error(`Calendario: no se pudo leer ${fuente}:`, error);
  throw new Error(fuente);
}

/** Un instante a día calendario de Paraguay. */
function diaParaguay(instante: unknown): string | null {
  const valor = texto(instante);
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : hoyEnParaguay(d);
}

/** Paraguay está en UTC-3 todo el año desde 2024. */
const ini = (fecha: string) => `${fecha}T00:00:00-03:00`;
const fin = (fecha: string) => `${sumarDias(fecha, 1)}T00:00:00-03:00`;

// ---------------------------------------------------------------------------
// Lo que la persona anota a mano
// ---------------------------------------------------------------------------

async function propios(c: ContextoAgenda): Promise<EventoAgenda[]> {
  let consulta = c.supabase
    .from("eos_calendario_eventos")
    .select("id,titulo,detalle,categoria,fecha,hora_inicio,hora_fin,estado,contacto_nombre")
    .eq("usuario_id", c.usuarioId)
    .gte("fecha", c.desde)
    .lte("fecha", c.hasta)
    .limit(1000);

  if (c.soloPendientes) consulta = consulta.eq("estado", "pendiente");

  const { data, error } = await consulta;

  if (error) falla("tu agenda", error);

  return ((data ?? []) as Fila[]).map((f) =>
    base({
      id: `propio:${f.id}`,
      origen: "propio",
      categoria: f.categoria as CategoriaPropia,
      titulo: String(f.titulo),
      detalle: texto(f.detalle),
      fecha: String(f.fecha),
      hora: normalizarHora(f.hora_inicio),
      hora_fin: normalizarHora(f.hora_fin),
      estado: f.estado as EstadoAgenda,
      contacto: texto(f.contacto_nombre),
      editable: true,
      completable: true,
    }),
  );
}

// ---------------------------------------------------------------------------
// CRM: lo que se habló, lo que hay que hacer y lo que se espera cerrar
// ---------------------------------------------------------------------------

const ROTULO_ACTIVIDAD: Record<string, string> = {
  llamada: "Llamada",
  reunion: "Reunión",
  correo: "Correo",
  nota: "Nota",
};

async function crmActividades(c: ContextoAgenda): Promise<EventoAgenda[]> {
  let consulta = c.supabase
    .from("eos_crm_actividades")
    .select("id,tipo,detalle,fecha,hecha,contacto:eos_crm_contactos(id,nombre)")
    .or(filtroDeEmpresa(c.usuarioId, c.empresaId))
    .gte("fecha", c.desde)
    .lte("fecha", c.hasta)
    .order("fecha", { ascending: true })
    .limit(LIMITE);

  if (c.soloPendientes) consulta = consulta.eq("hecha", false);

  const { data, error } = await consulta;

  if (error) falla("las actividades del CRM", error);

  const eventos: EventoAgenda[] = [];

  for (const f of (data ?? []) as Fila[]) {
    const tipo = String(f.tipo);
    const hecha = f.hecha === true;

    // Cada mensaje de WhatsApp que entra deja una actividad ya hecha. Son
    // decenas por día y taparían todo lo demás; el historial está en la ficha
    // del contacto, donde sí se lee en orden.
    if (tipo === "whatsapp" && hecha) continue;

    const { titulo, resto } = titular(String(f.detalle ?? ""));
    const rotulo = ROTULO_ACTIVIDAD[tipo];

    let categoria: CategoriaAgenda;
    if (tipo === "tarea") categoria = hecha ? "trabajo" : "seguimiento";
    else if (tipo === "reunion") categoria = "agenda";
    else categoria = "actividad";

    eventos.push(
      base({
        id: `crm:${f.id}`,
        origen: "crm",
        categoria,
        titulo: rotulo && tipo !== "tarea" ? `${rotulo}: ${titulo}` : titulo,
        detalle: resto,
        fecha: String(f.fecha),
        estado: hecha ? "hecho" : "pendiente",
        contacto: nombreDeContacto(f),
        // Se completa desde el calendario con el mismo PATCH que usa el CRM.
        completable: !hecha,
      }),
    );
  }

  return eventos;
}

async function crmOportunidades(c: ContextoAgenda): Promise<EventoAgenda[]> {
  const columnas = "id,titulo,monto,moneda,etapa,cierre_estimado,cerrada_en,contacto:eos_crm_contactos(nombre)";

  const [abiertas, ganadas] = await Promise.all([
    c.supabase
      .from("eos_crm_oportunidades")
      .select(columnas)
      .or(filtroDeEmpresa(c.usuarioId, c.empresaId))
      .not("etapa", "in", "(ganada,perdida)")
      .gte("cierre_estimado", c.desde)
      .lte("cierre_estimado", c.hasta)
      .limit(LIMITE),
    c.soloPendientes
      ? Promise.resolve({ data: [], error: null })
      : c.supabase
          .from("eos_crm_oportunidades")
          .select(columnas)
          .or(filtroDeEmpresa(c.usuarioId, c.empresaId))
          .eq("etapa", "ganada")
          .gte("cerrada_en", ini(c.desde))
          .lt("cerrada_en", fin(c.hasta))
          .limit(LIMITE),
  ]);

  if (abiertas.error) falla("las oportunidades del CRM", abiertas.error);
  if (ganadas.error) falla("las oportunidades ganadas", ganadas.error);

  const eventos: EventoAgenda[] = [];

  for (const f of (abiertas.data ?? []) as Fila[]) {
    eventos.push(
      base({
        id: `crm-op:${f.id}`,
        origen: "crm",
        categoria: "seguimiento",
        titulo: `Cierre estimado: ${String(f.titulo)}`,
        detalle: `Etapa: ${String(f.etapa)}`,
        fecha: String(f.cierre_estimado),
        contacto: nombreDeContacto(f),
        monto: numero(f.monto),
        moneda: texto(f.moneda) ?? "PYG",
      }),
    );
  }

  for (const f of (ganadas.data ?? []) as Fila[]) {
    const fecha = diaParaguay(f.cerrada_en);
    if (!fecha || fecha < c.desde || fecha > c.hasta) continue;

    eventos.push(
      base({
        id: `crm-op-ganada:${f.id}`,
        origen: "crm",
        categoria: "trabajo",
        titulo: `Venta cerrada: ${String(f.titulo)}`,
        fecha,
        estado: "hecho",
        contacto: nombreDeContacto(f),
        monto: numero(f.monto),
        moneda: texto(f.moneda) ?? "PYG",
      }),
    );
  }

  return eventos;
}

// ---------------------------------------------------------------------------
// ERP: lo que hay que cobrar, lo que hay que pagar y lo que ya se hizo
// ---------------------------------------------------------------------------

/**
 * Cuánto se cobró (o pagó) de cada documento.
 *
 * Sin esto un documento con vencimiento aparecería "por cobrar" aunque ya
 * estuviera saldado, que es peor que no mostrarlo: la persona llamaría a un
 * cliente que ya pagó. Es la misma cuenta que hace la cartera.
 */
async function pagadoPorDocumento(
  c: ContextoAgenda,
  columna: "venta_id" | "compra_id",
  ids: string[],
): Promise<Map<string, number>> {
  const pagado = new Map<string, number>();
  if (ids.length === 0) return pagado;

  const { data, error } = await c.admin
    .from("eos_erp_cuenta_movimientos_v107")
    .select(`${columna},monto`)
    .or(filtroDeEmpresa(c.usuarioId, c.empresaId))
    .in(columna, ids);

  // Sin los pagos los saldos saldrían iguales al total, o sea mal: mejor no
  // mostrar nada que mostrar deudas que ya se cancelaron.
  if (error) falla("los cobros y pagos registrados", error);

  for (const m of (data ?? []) as Fila[]) {
    const clave = m[columna] as string | null;
    if (clave) pagado.set(clave, (pagado.get(clave) ?? 0) + numero(m.monto));
  }

  return pagado;
}

async function erpVencimientos(
  c: ContextoAgenda,
  tipo: "cobro" | "pago",
): Promise<EventoAgenda[]> {
  const esCobro = tipo === "cobro";
  const tabla = esCobro ? "eos_erp_ventas" : "eos_erp_compras";
  const columna = esCobro ? "venta_id" : "compra_id";

  const { data, error } = await c.admin
    .from(tabla)
    .select("id,vence_el,moneda,total,contacto:eos_crm_contactos(nombre)")
    .or(filtroDeEmpresa(c.usuarioId, c.empresaId))
    .eq("estado", esCobro ? "emitida" : "registrada")
    .not("vence_el", "is", null)
    .gte("vence_el", c.desde)
    .lte("vence_el", c.hasta)
    .order("vence_el", { ascending: true })
    .limit(LIMITE);

  if (error) falla(esCobro ? "los cobros por vencer" : "los pagos por vencer", error);

  const filas = (data ?? []) as Fila[];
  const pagado = await pagadoPorDocumento(c, columna, filas.map((f) => String(f.id)));

  const eventos: EventoAgenda[] = [];

  for (const f of filas) {
    const total = numero(f.total);
    const yaPagado = pagado.get(String(f.id)) ?? 0;

    // La misma tolerancia de la cartera (`estaPendiente`), para que el
    // calendario y "Por cobrar" no discrepen sobre qué está pendiente.
    const saldo = Math.max(0, total - yaPagado);
    if (saldo <= SALDO_CERO) continue;

    const cliente = nombreDeContacto(f);

    eventos.push(
      base({
        id: `erp-${tipo}:${f.id}`,
        origen: "erp",
        categoria: tipo,
        titulo: esCobro
          ? cliente ? `Cobrar a ${cliente}` : "Cobro pendiente"
          : cliente ? `Pagar a ${cliente}` : "Pago pendiente",
        detalle: yaPagado > 0 ? "Tiene un pago parcial: se muestra lo que falta." : null,
        fecha: String(f.vence_el),
        contacto: cliente,
        monto: saldo,
        moneda: texto(f.moneda) ?? "PYG",
      }),
    );
  }

  return eventos;
}

/** Las ventas hechas: lo que la persona efectivamente trabajó. */
async function erpVentasHechas(c: ContextoAgenda): Promise<EventoAgenda[]> {
  if (c.soloPendientes) return [];

  // Solo el pasado y hoy: una venta no puede estar hecha en el futuro.
  const hasta = c.hasta < c.hoy ? c.hasta : c.hoy;
  if (c.desde > hasta) return [];

  const { data, error } = await c.admin
    .from("eos_erp_ventas")
    .select("id,fecha,moneda,total,contacto:eos_crm_contactos(nombre)")
    .or(filtroDeEmpresa(c.usuarioId, c.empresaId))
    .in("estado", ["emitida", "cobrada"])
    .gte("fecha", c.desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: true })
    .limit(LIMITE);

  if (error) falla("las ventas realizadas", error);

  return ((data ?? []) as Fila[]).map((f) => {
    const cliente = nombreDeContacto(f);
    return base({
      id: `erp-venta:${f.id}`,
      origen: "erp",
      categoria: "trabajo",
      titulo: cliente ? `Venta a ${cliente}` : "Venta realizada",
      fecha: String(f.fecha),
      estado: "hecho",
      contacto: cliente,
      monto: numero(f.total),
      moneda: texto(f.moneda) ?? "PYG",
    });
  });
}

// ---------------------------------------------------------------------------
// Metas y decisiones
// ---------------------------------------------------------------------------

/**
 * Las metas se leen por ámbito, una consulta cada uno.
 *
 * `eos_goals` guarda metas del negocio y metas personales en la misma tabla
 * (v144) y el resto de EOS nunca las mezcla: el panel de la persona no muestra
 * las del negocio. Acá SÍ se muestran las dos, porque un calendario es de la
 * persona entera, pero cada evento dice de cuál es y no hay ninguna cuenta que
 * las sume. Consultarlas por separado es lo que deja esa decisión escrita en el
 * código en vez de en un `select *` que "por casualidad" trae todo.
 */
const AMBITOS = ["negocio", "personal"] as const;
type Ambito = (typeof AMBITOS)[number];

const DE_QUIEN: Record<Ambito, string> = { negocio: "del negocio", personal: "personal" };

async function metasDe(c: ContextoAgenda, ambito: Ambito): Promise<EventoAgenda[]> {
  const [vencen, cumplidas] = await Promise.all([
    c.supabase
      .from("eos_goals")
      .select("id,titulo,progreso,proximo_paso,fecha_limite")
      .eq("usuario_id", c.usuarioId)
      .eq("ambito", ambito)
      .in("estado", ["activo", "pausado"])
      .gte("fecha_limite", c.desde)
      .lte("fecha_limite", c.hasta)
      .limit(LIMITE),
    c.soloPendientes
      ? Promise.resolve({ data: [], error: null })
      : c.supabase
          .from("eos_goals")
          .select("id,titulo,completado_at")
          .eq("usuario_id", c.usuarioId)
          .eq("ambito", ambito)
          .eq("estado", "completado")
          .gte("completado_at", ini(c.desde))
          .lt("completado_at", fin(c.hasta))
          .limit(LIMITE),
  ]);

  if (vencen.error) falla("las metas", vencen.error);
  if (cumplidas.error) falla("las metas cumplidas", cumplidas.error);

  const eventos: EventoAgenda[] = [];

  for (const f of (vencen.data ?? []) as Fila[]) {
    const proximoPaso = texto(f.proximo_paso);

    eventos.push(
      base({
        id: `meta:${f.id}`,
        origen: "metas",
        categoria: "meta",
        titulo: `Vence la meta: ${String(f.titulo)}`,
        detalle: [
          `Meta ${DE_QUIEN[ambito]}`,
          `Progreso: ${numero(f.progreso)}%`,
          proximoPaso ? `Próximo paso: ${proximoPaso}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        fecha: String(f.fecha_limite),
      }),
    );
  }

  for (const f of (cumplidas.data ?? []) as Fila[]) {
    const fecha = diaParaguay(f.completado_at);
    if (!fecha || fecha < c.desde || fecha > c.hasta) continue;

    eventos.push(
      base({
        id: `meta-hecha:${f.id}`,
        origen: "metas",
        categoria: "trabajo",
        titulo: `Meta cumplida: ${String(f.titulo)}`,
        detalle: `Meta ${DE_QUIEN[ambito]}`,
        fecha,
        estado: "hecho",
      }),
    );
  }

  return eventos;
}

async function decisionesARevisar(c: ContextoAgenda): Promise<EventoAgenda[]> {
  const { data, error } = await c.supabase
    .from("eos_decisions")
    .select("id,titulo,fecha_revision")
    .eq("usuario_id", c.usuarioId)
    .in("estado", ["activa", "en_revision"])
    .gte("fecha_revision", c.desde)
    .lte("fecha_revision", c.hasta)
    .limit(LIMITE);

  if (error) falla("las decisiones a revisar", error);

  return ((data ?? []) as Fila[]).map((f) =>
    base({
      id: `decision:${f.id}`,
      origen: "metas",
      categoria: "meta",
      titulo: `Revisar la decisión: ${String(f.titulo)}`,
      fecha: String(f.fecha_revision),
    }),
  );
}

async function metas(c: ContextoAgenda): Promise<EventoAgenda[]> {
  const partes = await Promise.all([...AMBITOS.map((a) => metasDe(c, a)), decisionesARevisar(c)]);
  return partes.flat();
}

// ---------------------------------------------------------------------------
// Finanzas personales: alquiler, cuotas, tarjetas, sueldo
// ---------------------------------------------------------------------------

/** El panorama proyecta como mucho 90 días: más allá no hay nada que mostrar. */
const HORIZONTE_FINANZAS = 90;

async function finanzasPersonales(c: ContextoAgenda): Promise<EventoAgenda[]> {
  // Solo el futuro: el pasado ya es un movimiento, no un vencimiento.
  const desde = c.desde > c.hoy ? c.desde : c.hoy;
  const tope = sumarDias(c.hoy, HORIZONTE_FINANZAS);
  const hasta = c.hasta < tope ? c.hasta : tope;
  if (desde > hasta) return [];

  const leido = await leerPanoramaPersonal(c.supabase, c.usuarioId, c.hoy, tope);
  if (!leido.configurado) return [];

  const eventos: EventoAgenda[] = [];
  let n = 0;

  for (const i of leido.panorama.ingresos) {
    if (i.fecha < desde || i.fecha > hasta) continue;
    eventos.push(
      base({
        id: `finanzas:${i.fecha}:${n++}`,
        origen: "finanzas",
        categoria: "cobro",
        titulo: i.descripcion || "Ingreso previsto",
        detalle: "Finanzas personales",
        fecha: i.fecha,
        monto: i.monto,
        moneda: leido.moneda,
      }),
    );
  }

  for (const e of leido.panorama.egresos) {
    if (e.fecha < desde || e.fecha > hasta) continue;
    eventos.push(
      base({
        id: `finanzas:${e.fecha}:${n++}`,
        origen: "finanzas",
        categoria: "pago",
        titulo: e.descripcion || "Pago previsto",
        // Lo que EOS dedujo de verlo repetirse no es un compromiso firme; se
        // dice para que nadie lo tome por uno (mismo criterio que el panel).
        detalle: e.fuente === "previsible" ? "Finanzas personales · estimado por EOS" : "Finanzas personales",
        fecha: e.fecha,
        monto: e.monto,
        moneda: leido.moneda,
      }),
    );
  }

  return eventos;
}

// ---------------------------------------------------------------------------

export type ResultadoAgenda = {
  eventos: EventoAgenda[];
  /** Nombres, en castellano, de las fuentes que no se pudieron leer. */
  fuentes_caidas: string[];
};

export async function armarAgenda(c: ContextoAgenda): Promise<ResultadoAgenda> {
  const tareas: Promise<EventoAgenda[]>[] = [propios(c), metas(c)];

  if (c.modulos.crm) tareas.push(crmActividades(c), crmOportunidades(c));
  if (c.modulos.erp) {
    tareas.push(erpVencimientos(c, "cobro"), erpVencimientos(c, "pago"), erpVentasHechas(c));
  }
  if (c.modulos.finanzas) tareas.push(finanzasPersonales(c));

  const resultados = await Promise.allSettled(tareas);

  const eventos: EventoAgenda[] = [];
  const caidas = new Set<string>();

  for (const r of resultados) {
    if (r.status === "fulfilled") eventos.push(...r.value);
    else caidas.add(r.reason instanceof Error ? r.reason.message : "una fuente");
  }

  return { eventos: eventos.sort(compararEventos), fuentes_caidas: [...caidas] };
}
