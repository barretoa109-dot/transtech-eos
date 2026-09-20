import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { filtroDeEmpresa, miEmpresa } from "@/lib/empresa/acceso";
import {
  armarHistorial,
  COLUMNAS_FICHA,
  faltaLaFicha,
  resumenDeFicha,
  type ActividadFila,
  type MensajeFila,
  type OportunidadFila,
  type VentaFila,
} from "@/lib/crm/ficha";

export const dynamic = "force-dynamic";

/**
 * La ficha de un cliente: sus datos, su historia y lo que hay abierto con él.
 *
 * Todo se lee con la SESIÓN de la persona: la RLS decide qué ve, y el cliente se busca con
 * el filtro de empresa de siempre. Un id de otra cuenta devuelve 404, igual que uno que no existe.
 *
 * SI UNA FUENTE FALLA, SE DICE. El historial junta cuatro tablas (mensajes, actividades,
 * oportunidades, ventas). Si una no se pudo leer, el historial que se muestra está incompleto, y
 * mostrarlo como si fuera todo llevaría a creer que «nunca se le escribió» cuando lo que pasó es
 * que no pudimos mirar. Por eso la respuesta trae `incompleto: [...]` con lo que faltó.
 */

const COLUMNAS_CONTACTO =
  "id,tipo,nombre,ruc,ruc_dv,documento,email,telefono,direccion,ciudad," +
  "es_cliente,es_proveedor,etiquetas,notas,activo,creado_en";

const COLUMNAS_OP_BASE =
  "id,titulo,detalle,monto,moneda,etapa,cierre_estimado,motivo_perdida,creado_en,cerrada_en";
const COLUMNAS_OP = `${COLUMNAS_OP_BASE},probabilidad,producto_servicio,proxima_accion_en`;

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

type Fuente<T> = { filas: T[]; fallo: boolean };

/** Una fuente del historial: si falla, `fallo` y vacía, para poder avisarlo. */
async function fuente<T>(consulta: PromiseLike<{ data: unknown; error: unknown }>, nombre: string): Promise<Fuente<T>> {
  const { data, error } = await consulta;
  if (error) {
    console.error(`CRM: no se pudo leer ${nombre} de la ficha:`, error);
    return { filas: [], fallo: true };
  }
  return { filas: (data ?? []) as T[], fallo: false };
}

export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404, headers: noStore });
  }

  const supabase = await createClient();
  const empresaId = await miEmpresa(supabase);

  const pedirContacto = (columnas: string) =>
    supabase.from("eos_crm_contactos").select(columnas).eq("id", id).or(filtroDeEmpresa(puerta.usuarioId, empresaId)).maybeSingle();

  let { data: contacto, error } = await pedirContacto(`${COLUMNAS_CONTACTO},${COLUMNAS_FICHA}`);
  if (error && faltaLaFicha(error)) ({ data: contacto, error } = await pedirContacto(COLUMNAS_CONTACTO));

  if (error) {
    console.error("CRM: no se pudo leer el cliente:", error);
    return NextResponse.json({ error: "No pudimos cargar la ficha." }, { status: 503, headers: noStore });
  }
  if (!contacto) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404, headers: noStore });
  }

  const pedirOportunidades = (columnas: string) =>
    supabase
      .from("eos_crm_oportunidades")
      .select(columnas)
      .eq("contacto_id", id)
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
      .order("creado_en", { ascending: false })
      .limit(50);

  const oportunidadesConNuevas = await pedirOportunidades(COLUMNAS_OP);
  const consultaOp =
    oportunidadesConNuevas.error && faltaLaFicha(oportunidadesConNuevas.error)
      ? await pedirOportunidades(COLUMNAS_OP_BASE)
      : oportunidadesConNuevas;

  const [mensajes, actividades, oportunidades, ventas, consentimiento] = await Promise.all([
    fuente<MensajeFila>(
      supabase
        .from("eos_wa_mensajes")
        .select("direccion,tipo,texto,estado,motivo,origen,ocurrio_en")
        .eq("contacto_id", id)
        .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
        .order("ocurrio_en", { ascending: false })
        .limit(100),
      "los mensajes",
    ),
    fuente<ActividadFila>(
      supabase
        .from("eos_crm_actividades")
        .select("id,tipo,detalle,fecha,hecha")
        .eq("contacto_id", id)
        .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
        .order("fecha", { ascending: false })
        .limit(100),
      "las actividades",
    ),
    fuente<OportunidadFila & Record<string, unknown>>(Promise.resolve(consultaOp), "las oportunidades"),
    fuente<VentaFila>(
      supabase
        .from("eos_erp_ventas")
        .select("id,fecha,total,moneda,estado")
        .eq("contacto_id", id)
        .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
        .order("fecha", { ascending: false })
        .limit(50),
      "las ventas",
    ),
    fuente<{ estado: string }>(
      supabase.from("eos_wa_consentimientos").select("estado").eq("contacto_id", id).or(filtroDeEmpresa(puerta.usuarioId, empresaId)).limit(1),
      "el consentimiento",
    ),
  ]);

  const filas = {
    mensajes: mensajes.filas,
    actividades: actividades.filas,
    oportunidades: oportunidades.filas.map((o) => ({ ...o, monto: Number(o.monto ?? 0) })),
    ventas: ventas.filas.map((v) => ({ ...v, total: Number(v.total ?? 0) })),
  };

  const incompleto = Object.entries({ mensajes, actividades, oportunidades, ventas })
    .filter(([, f]) => f.fallo)
    .map(([nombre]) => nombre);

  return NextResponse.json(
    {
      contacto,
      oportunidades: filas.oportunidades,
      historial: armarHistorial(filas),
      resumen: resumenDeFicha(filas, new Date()),
      whatsapp: { baja: consentimiento.filas.some((c) => c.estado === "revocado") },
      incompleto,
    },
    { headers: noStore },
  );
}
