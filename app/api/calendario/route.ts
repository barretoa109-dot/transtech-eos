import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { miEmpresa } from "@/lib/empresa/acceso";
import { verificarModulo } from "@/lib/modulos/acceso";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarAgenda, tareasSinFecha, type ContextoAgenda, type TareaSinFecha } from "@/lib/calendario/fuentes";
import {
  agendaAInstante,
  compararEventos,
  diasDeGrilla,
  esFechaValida,
  mesDe,
  resumir,
  validarEventoPropio,
} from "@/lib/calendario/agenda";

export const dynamic = "force-dynamic";

/**
 * El calendario: todo lo que tiene fecha, en un solo lugar.
 *
 * ============================================================
 * QUÉ DEVUELVE
 * ============================================================
 *
 * Tres cosas, cada una con su propia consulta:
 *
 *   · `eventos`   — lo que cae en el rango pedido (el mes que se está mirando)
 *   · `pendientes`— lo que quedó por hacer entre hace 60 días y dentro de 7
 *   · `resumen`   — las tres cifras de arriba, calculadas sobre `pendientes`
 *
 * `pendientes` es independiente del mes que se mira, a propósito. Si el resumen
 * se calculara sobre `eventos`, alguien que navega a noviembre vería "0
 * atrasados" y "0 para hoy" porque en noviembre no hay nada atrasado: el número
 * dejaría de decir cómo está HOY y pasaría a decir cómo está el mes que
 * mira.
 *
 * ============================================================
 * QUIÉN LO PUEDE VER
 * ============================================================
 *
 * El calendario en sí es de todos: alguien sin ningún módulo también tiene citas
 * y recordatorios. Cada fuente que viene de un módulo (CRM, ERP) se incluye solo
 * si el módulo está vigente, con la misma puerta que las rutas de ese módulo.
 * Una tarea del CRM no se cuela por el calendario a quien no lo contrató.
 */

/** Cuánto hacia atrás se busca lo que quedó sin hacer. */
const DIAS_ATRAS = 60;
/** Una grilla de mes son 42 días; con margen para pedir dos meses. */
const MAX_DIAS_RANGO = 70;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ESTADOS = new Set(["pendiente", "hecho", "cancelado"]);

/**
 * Las tareas que EOS anota desde el chat viven en `eos_tasks`, con su propio
 * vocabulario de estados. El id llega con el prefijo `tarea:` para no confundirlas
 * con los eventos propios, y acá se traduce en los dos sentidos.
 */
const PREFIJO_TAREA = "tarea:";
const ESTADO_DE_TAREA: Record<string, string> = {
  pendiente: "pendiente",
  hecho: "completada",
  cancelado: "cancelada",
};

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function responder(cuerpo: unknown, status = 200) {
  return NextResponse.json(cuerpo, { status, headers: noStore() });
}

async function sesion() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { supabase, usuarioId: error || !user ? null : user.id };
}

export async function GET(request: Request) {
  const { supabase, usuarioId } = await sesion();
  if (!usuarioId) return responder({ error: "Sesión no válida." }, 401);

  const hoy = hoyEnParaguay();
  const { searchParams } = new URL(request.url);

  // Sin rango pedido: la grilla del mes actual, que es lo primero que se ve.
  const grilla = diasDeGrilla(mesDe(hoy).anio, mesDe(hoy).mes);
  let desde = grilla[0];
  let hasta = grilla[grilla.length - 1];

  const pedidoDesde = searchParams.get("desde");
  const pedidoHasta = searchParams.get("hasta");

  if (pedidoDesde || pedidoHasta) {
    if (!esFechaValida(pedidoDesde) || !esFechaValida(pedidoHasta) || pedidoDesde > pedidoHasta) {
      return responder({ error: "El rango de fechas no es válido." }, 400);
    }

    const dias = (Date.parse(pedidoHasta) - Date.parse(pedidoDesde)) / 86_400_000;
    if (dias > MAX_DIAS_RANGO) {
      return responder({ error: "Pediste demasiados días de una vez." }, 400);
    }

    desde = pedidoDesde;
    hasta = pedidoHasta;
  }

  const [crm, erp, finanzas] = await Promise.all([
    verificarModulo("crm"),
    verificarModulo("erp"),
    // El panel financiero es gratis para todos desde la v165, pero pasa por la
    // misma puerta que su propia ruta por si eso cambia.
    verificarModulo("dashboard"),
  ]);

  const modulos = { crm: crm.permitido, erp: erp.permitido, finanzas: finanzas.permitido };

  const empresaId = modulos.crm || modulos.erp ? await miEmpresa(supabase) : null;

  // Fail closed: con CRM o ERP pero sin poder resolver la empresa, esas fuentes
  // filtrarían por una empresa inexistente y devolverían vacío, que la pantalla
  // leería como "no hay nada". Se apagan y se avisa.
  const sinEmpresa = (modulos.crm || modulos.erp) && !empresaId;
  const habilitados = sinEmpresa ? { ...modulos, crm: false, erp: false } : modulos;

  const contexto: ContextoAgenda = {
    usuarioId,
    empresaId,
    supabase,
    admin: adminSinTipos(),
    hoy,
    desde,
    hasta,
    modulos: habilitados,
  };

  const limitePendientes = sumarDias(hoy, 7);

  const [rango, pendientes] = await Promise.all([
    armarAgenda(contexto),
    armarAgenda({
      ...contexto,
      desde: sumarDias(hoy, -DIAS_ATRAS),
      hasta: limitePendientes,
      soloPendientes: true,
    }),
  ]);

  const porHacer = pendientes.eventos.filter((e) => e.estado === "pendiente");

  const fuentesCaidas = new Set([...rango.fuentes_caidas, ...pendientes.fuentes_caidas]);
  if (sinEmpresa) fuentesCaidas.add("tu CRM y tu ERP");

  // Las tareas sin día no tienen lugar en la grilla, pero no se callan: van en su
  // propia lista. Si no se pueden leer, se dice, igual que con cualquier fuente.
  let sinFecha: TareaSinFecha[] = [];
  try {
    sinFecha = await tareasSinFecha({ supabase, usuarioId });
  } catch {
    fuentesCaidas.add("tus tareas sin fecha");
  }

  return responder({
    hoy,
    desde,
    hasta,
    modulos: habilitados,
    eventos: rango.eventos,
    atrasados: porHacer.filter((e) => e.fecha < hoy).sort(compararEventos),
    proximos: porHacer.filter((e) => e.fecha >= hoy).sort(compararEventos),
    sin_fecha: sinFecha,
    resumen: resumir(porHacer, hoy),
    fuentes_caidas: [...fuentesCaidas],
  });
}

export async function POST(request: Request) {
  const { supabase, usuarioId } = await sesion();
  if (!usuarioId) return responder({ error: "Sesión no válida." }, 401);

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return responder({ error: "Cuerpo inválido." }, 400);
  }

  const validado = validarEventoPropio(cuerpo);
  if (!validado.ok) return responder({ error: validado.error }, 400);

  const { data, error } = await supabase
    .from("eos_calendario_eventos")
    .insert({ usuario_id: usuarioId, ...validado.datos })
    .select("id")
    .single();

  if (error) {
    console.error("Calendario: no se pudo guardar el evento:", error);
    return responder({ error: "No pudimos guardar el evento." }, 503);
  }

  return responder({ id: data.id }, 201);
}

/**
 * Dos usos con la misma ruta: marcar hecho/pendiente/cancelado (el gesto de
 * todos los días, solo manda `estado`) o editar el evento entero.
 */
export async function PATCH(request: Request) {
  const { supabase, usuarioId } = await sesion();
  if (!usuarioId) return responder({ error: "Sesión no válida." }, 401);

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return responder({ error: "Cuerpo inválido." }, 400);
  }

  const idPedido = String(cuerpo.id ?? "");
  const esTarea = idPedido.startsWith(PREFIJO_TAREA);
  const id = esTarea ? idPedido.slice(PREFIJO_TAREA.length) : idPedido;
  if (!UUID.test(id)) return responder({ error: "No encontrado." }, 404);

  // "Hecho" sobre UNA ocurrencia de una serie: se anota ese día en `repite_hechas` y
  // las demás quedan como estaban. Sin esto, marcar el pago de septiembre como hecho
  // marcaría todos los meses.
  if (cuerpo.ocurrencia !== undefined && cuerpo.titulo === undefined) {
    return marcarOcurrencia(supabase, usuarioId, esTarea ? "eos_tasks" : "eos_calendario_eventos", id, cuerpo);
  }

  if (esTarea) return actualizarTarea(supabase, usuarioId, id, cuerpo);

  let cambios: Record<string, unknown>;

  if (cuerpo.titulo === undefined) {
    // Solo el estado.
    if (!ESTADOS.has(String(cuerpo.estado))) return responder({ error: "Estado no válido." }, 400);
    cambios = { estado: cuerpo.estado };
  } else {
    const validado = validarEventoPropio(cuerpo);
    if (!validado.ok) return responder({ error: validado.error }, 400);
    cambios = { ...validado.datos };
    // Sin regla, no hay ocurrencias que recordar como hechas.
    if (!validado.datos.repite) cambios.repite_hechas = [];
    if (ESTADOS.has(String(cuerpo.estado))) cambios.estado = cuerpo.estado;
  }

  const { data, error } = await supabase
    .from("eos_calendario_eventos")
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Calendario: no se pudo actualizar el evento:", error);
    return responder({ error: "No pudimos guardar el cambio." }, 503);
  }

  if (!data) return responder({ error: "No encontrado." }, 404);

  return responder({ id: data.id });
}

export async function DELETE(request: Request) {
  const { supabase, usuarioId } = await sesion();
  if (!usuarioId) return responder({ error: "Sesión no válida." }, 401);

  const idPedido = new URL(request.url).searchParams.get("id") ?? "";
  const esTarea = idPedido.startsWith(PREFIJO_TAREA);
  const id = esTarea ? idPedido.slice(PREFIJO_TAREA.length) : idPedido;
  if (!UUID.test(id)) return responder({ error: "No encontrado." }, 404);

  const { data, error } = await supabase
    .from(esTarea ? "eos_tasks" : "eos_calendario_eventos")
    .delete()
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Calendario: no se pudo borrar el evento:", error);
    return responder({ error: "No pudimos borrarlo." }, 503);
  }

  if (!data) return responder({ error: "No encontrado." }, 404);

  return responder({ ok: true });
}

/**
 * Marcar hecha, reabrir o reprogramar una tarea del chat.
 *
 * Es la misma fila que ve el resto de EOS: `eos_tasks.estado` es la fuente de
 * verdad, así que completarla desde el calendario la completa en todos lados.
 * La RLS de la tabla ya limita a las propias; el `.eq("usuario_id")` es el
 * cinturón que acompaña al tirante.
 */
async function actualizarTarea(
  supabase: Awaited<ReturnType<typeof createClient>>,
  usuarioId: string,
  id: string,
  cuerpo: Record<string, unknown>,
) {
  let cambios: Record<string, unknown>;

  if (cuerpo.titulo === undefined) {
    const estado = ESTADO_DE_TAREA[String(cuerpo.estado)];
    if (!estado) return responder({ error: "Estado no válido." }, 400);
    cambios = { estado };
  } else {
    const validado = validarEventoPropio(cuerpo);
    if (!validado.ok) return responder({ error: validado.error }, 400);

    const d = validado.datos;
    cambios = {
      titulo: d.titulo,
      descripcion: d.detalle,
      fecha_limite: agendaAInstante(d.fecha, d.hora_inicio),
      repite: d.repite,
      repite_hasta: d.repite_hasta,
      ...(d.repite ? {} : { repite_hechas: [] }),
    };
    if (ESTADO_DE_TAREA[String(cuerpo.estado)]) cambios.estado = ESTADO_DE_TAREA[String(cuerpo.estado)];
  }

  const { data, error } = await supabase
    .from("eos_tasks")
    .update(cambios)
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Calendario: no se pudo actualizar la tarea:", error);
    return responder({ error: "No pudimos guardar el cambio." }, 503);
  }

  if (!data) return responder({ error: "No encontrado." }, 404);

  return responder({ id: data.id });
}

/**
 * Marcar hecha (o reabrir) UNA ocurrencia de un evento que se repite.
 *
 * El estado de una serie no es una columna sino una lista de días: `repite_hechas`.
 * Se lee y se reescribe entera porque el cliente de Supabase no expone
 * `array_append`; una carrera entre dos pestañas de la misma persona a la vez
 * pisaría un "hecho" como mucho, y el efecto es que la ocurrencia vuelve a
 * aparecer pendiente.
 */
async function marcarOcurrencia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  usuarioId: string,
  tabla: "eos_tasks" | "eos_calendario_eventos",
  id: string,
  cuerpo: Record<string, unknown>,
) {
  if (!esFechaValida(cuerpo.ocurrencia)) return responder({ error: "La fecha no es válida." }, 400);
  if (cuerpo.estado !== "hecho" && cuerpo.estado !== "pendiente") return responder({ error: "Estado no válido." }, 400);

  const { data: fila, error: errorLectura } = await supabase
    .from(tabla)
    .select("repite,repite_hechas")
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (errorLectura) {
    console.error("Calendario: no se pudo leer la serie:", errorLectura);
    return responder({ error: "No pudimos guardar el cambio." }, 503);
  }

  if (!fila) return responder({ error: "No encontrado." }, 404);
  if (!fila.repite) return responder({ error: "Ese evento no se repite." }, 400);

  const hechas = new Set<string>(
    Array.isArray(fila.repite_hechas) ? fila.repite_hechas.map((d: unknown) => String(d).slice(0, 10)) : [],
  );

  if (cuerpo.estado === "hecho") hechas.add(cuerpo.ocurrencia);
  else hechas.delete(cuerpo.ocurrencia);

  const { error } = await supabase
    .from(tabla)
    .update({ repite_hechas: [...hechas].sort() })
    .eq("id", id)
    .eq("usuario_id", usuarioId);

  if (error) {
    console.error("Calendario: no se pudo marcar la ocurrencia:", error);
    return responder({ error: "No pudimos guardar el cambio." }, 503);
  }

  return responder({ id });
}
