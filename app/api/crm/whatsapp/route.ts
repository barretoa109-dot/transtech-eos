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
  // 42703: una columna que todavía no existe (la v185 sin aplicar).
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "42703";
}

export async function GET() {
  const puerta = await exigirAlgunModulo(["crm", "erp"]);
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();

  const [canales, mensajes, consentimientos, eventos] = await Promise.all([
    supabase
      .from("eos_wa_canales")
      .select(
        "id,nombre_visible,telefono,estado,respuesta_automatica,secreto_ref,secreto_app_ref,waba_id,verify_token," +
          "limite_diario,limite_por_contacto_dia,silencio_desde_hora,silencio_hasta_hora,ultimo_error,creado_en",
      )
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

  // El que sigue conectado. Uno desconectado se trata como "no hay canal": se puede
  // volver a conectar el mismo número desde el formulario.
  const canal = ((canales.data ?? []) as unknown as FilaCanal[]).find((c) => c.estado !== "desconectado");

  // Las plantillas del canal. Si la lectura falla, la pantalla igual funciona sin ellas.
  let plantillas: unknown[] = [];
  if (canal) {
    const { data: filasPlantillas } = await supabase
      .from("eos_wa_plantillas")
      .select("id,nombre,cuerpo,cantidad_variables,estado,motivo_rechazo,categoria")
      .eq("canal_id", canal.id)
      .order("creado_en", { ascending: false })
      .limit(50);
    plantillas = filasPlantillas ?? [];
  }

  return NextResponse.json(
    {
      disponible: true,
      canal: canal
        ? {
            id: canal.id,
            nombre: canal.nombre_visible,
            telefono: canal.telefono,
            estado: canal.estado,
            respuesta_automatica: canal.respuesta_automatica,
            // Si se puede ENVIAR: hace falta el token. Recibir no lo necesita.
            puede_enviar: canal.estado === "activo" && Boolean(canal.secreto_ref),
            tiene_waba: Boolean(canal.waba_id),
            tiene_secreto_app: Boolean(canal.secreto_app_ref),
            limite_diario: canal.limite_diario,
            limite_por_contacto_dia: canal.limite_por_contacto_dia,
            silencio_desde_hora: canal.silencio_desde_hora,
            silencio_hasta_hora: canal.silencio_hasta_hora,
            ultimo_error: canal.ultimo_error,
            // Lo que hay que pegar en Meta. NUNCA el token ni el secreto de la app:
            // esos no salen de Vault.
            verify_token: canal.verify_token,
          }
        : null,
      plantillas,
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

type FilaCanal = {
  id: string;
  nombre_visible: string | null;
  telefono: string | null;
  estado: string;
  respuesta_automatica: boolean;
  secreto_ref: string | null;
  secreto_app_ref: string | null;
  waba_id: string | null;
  verify_token: string | null;
  limite_diario: number;
  limite_por_contacto_dia: number;
  silencio_desde_hora: number;
  silencio_hasta_hora: number;
  ultimo_error: string | null;
};

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
