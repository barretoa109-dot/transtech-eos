import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirAlgunModulo } from "@/lib/modulos/acceso";
import {
  agruparConversaciones,
  type FilaConsentimiento,
  type FilaContacto,
  type FilaMensaje,
} from "@/lib/whatsapp-crm/conversaciones";

export const dynamic = "force-dynamic";

/**
 * Las conversaciones de WhatsApp de la empresa con sus clientes.
 *
 * ============================================================
 * DE QUIÉN SON LOS DATOS
 * ============================================================
 *
 * Todo se lee con la SESIÓN de quien pregunta, no con la clave de servicio: la
 * RLS de la v177 decide qué filas ve (las suyas o las de su empresa) y ninguna
 * consulta de acá puede devolver una conversación de otra empresa aunque se
 * olvide un filtro. Es lo contrario de las rutas que usan `adminSinTipos()`,
 * donde el filtro escrito a mano es la única frontera.
 *
 * Solo lectura: enviar requiere el token de Meta de cada empresa, que todavía
 * no está conectado (ver `docs/whatsapp-crm.md`). Esta ruta no finge que sí.
 */

const MAX_MENSAJES = 600;
const DIAS = 60;

/** La tabla todavía no existe: la migración v177 no está aplicada. */
function faltaLaMigracion(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function GET() {
  const puerta = await exigirAlgunModulo(["crm", "erp"]);
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();

  const [canales, mensajes, consentimientos, eventos] = await Promise.all([
    supabase
      .from("eos_wa_canales")
      .select("id,nombre_visible,telefono,estado,respuesta_automatica,secreto_ref")
      .order("creado_en", { ascending: true })
      .limit(5),
    supabase
      .from("eos_wa_mensajes")
      .select("id,contacto_id,direccion,telefono,texto,tipo,estado,motivo,origen,intencion,ocurrio_en")
      .gte("ocurrio_en", desde)
      .order("ocurrio_en", { ascending: false })
      .limit(MAX_MENSAJES),
    supabase.from("eos_wa_consentimientos").select("contacto_id,estado").limit(2000),
    supabase
      .from("eos_wa_eventos")
      .select("contacto_id,creado_en")
      .eq("evento", "requiere_atencion_humana")
      .gte("creado_en", desde)
      .limit(500),
  ]);

  if ([canales, mensajes, consentimientos, eventos].some((r) => faltaLaMigracion(r.error))) {
    return NextResponse.json({ disponible: false, canal: null, conversaciones: [] }, { headers: noStore() });
  }

  const fallo = [canales, mensajes, consentimientos, eventos].find((r) => r.error);
  if (fallo?.error) {
    console.error("CRM WhatsApp: no se pudieron leer las conversaciones:", fallo.error);
    return NextResponse.json(
      { error: "No pudimos cargar las conversaciones. Reintentá en un momento." },
      { status: 500, headers: noStore() },
    );
  }

  const filas = (mensajes.data ?? []) as FilaMensaje[];

  // Los nombres, solo de los clientes que aparecen: no se trae toda la agenda.
  const ids = [...new Set(filas.map((m) => m.contacto_id).filter((id): id is string => Boolean(id)))];

  let contactos: FilaContacto[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase.from("eos_crm_contactos").select("id,nombre,telefono").in("id", ids);
    if (error) {
      console.error("CRM WhatsApp: no se pudieron leer los clientes:", error);
      return NextResponse.json(
        { error: "No pudimos cargar las conversaciones. Reintentá en un momento." },
        { status: 500, headers: noStore() },
      );
    }
    contactos = (data ?? []) as FilaContacto[];
  }

  const canal = (canales.data ?? [])[0] as
    | {
        id: string;
        nombre_visible: string | null;
        telefono: string | null;
        estado: string;
        respuesta_automatica: boolean;
        secreto_ref: string | null;
      }
    | undefined;

  return NextResponse.json(
    {
      disponible: true,
      canal: canal
        ? {
            nombre: canal.nombre_visible,
            telefono: canal.telefono,
            estado: canal.estado,
            respuesta_automatica: canal.respuesta_automatica,
            // Si se puede ENVIAR: hace falta el token. Recibir no lo necesita.
            puede_enviar: canal.estado === "activo" && Boolean(canal.secreto_ref),
          }
        : null,
      conversaciones: agruparConversaciones({
        mensajes: filas,
        contactos,
        consentimientos: (consentimientos.data ?? []) as FilaConsentimiento[],
        eventosDeAtencion: (eventos.data ?? []) as { contacto_id: string | null; creado_en: string }[],
        ahora: new Date().toISOString(),
      }),
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
