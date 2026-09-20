import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { enviarPorCanal, type Contenido } from "@/lib/whatsapp-crm/enviar";

export const dynamic = "force-dynamic";

/**
 * Contestarle a un cliente por el WhatsApp de la empresa.
 *
 *   { contacto_id, clave, texto }                              texto libre
 *   { contacto_id, clave, plantilla_id, variables: [...] }     plantilla aprobada
 *
 * `clave` es un identificador que genera la pantalla en cada intento de envío: hace
 * que un doble clic, o un reintento de la red, no mande el mensaje dos veces.
 *
 * Quien lo manda es una PERSONA, así que la autorización es "aprobada": la política
 * (consentimiento, ventana de 24 horas, límites) igual se aplica entera, y lo que no
 * pueda salir vuelve con su motivo en castellano.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore });
  }

  const contactoId = String(cuerpo.contacto_id ?? "");
  const clave = String(cuerpo.clave ?? "");

  if (!UUID.test(contactoId)) {
    return NextResponse.json({ error: "Falta el cliente." }, { status: 400, headers: noStore });
  }
  if (clave.length < 8 || clave.length > 80) {
    return NextResponse.json({ error: "Falta la clave del envío." }, { status: 400, headers: noStore });
  }

  let contenido: Contenido;
  if (typeof cuerpo.plantilla_id === "string" && cuerpo.plantilla_id) {
    if (!UUID.test(cuerpo.plantilla_id)) {
      return NextResponse.json({ error: "Plantilla no válida." }, { status: 400, headers: noStore });
    }
    const variables = Array.isArray(cuerpo.variables) ? cuerpo.variables.map((v) => String(v ?? "")) : [];
    contenido = { tipo: "plantilla", plantillaId: cuerpo.plantilla_id, variables };
  } else {
    contenido = { tipo: "texto", texto: String(cuerpo.texto ?? "") };
  }

  // El canal de la persona: el que esté conectado y no desconectado.
  const supabase = await createClient();
  const { data: canal } = await supabase
    .from("eos_wa_canales")
    .select("id")
    .eq("usuario_id", puerta.usuarioId)
    .neq("estado", "desconectado")
    .order("creado_en", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!canal) {
    return NextResponse.json(
      { error: "Todavía no conectaste el WhatsApp de tu empresa." },
      { status: 409, headers: noStore },
    );
  }

  const r = await enviarPorCanal(adminSinTipos(), {
    usuarioId: puerta.usuarioId,
    canalId: (canal as { id: string }).id,
    contactoId,
    contenido,
    origen: "usuario",
    autorizacion: "aprobada",
    clave,
  });

  if (r.ok) {
    return NextResponse.json(
      { enviado: true, mensaje_id: r.mensajeId, ya_enviado: r.via === "ya_enviado" },
      { headers: noStore },
    );
  }

  // Lo que no salió, con su motivo. 422 = no se puede y hay que cambiar algo;
  // 502 = falló Meta por algo pasajero; 400 = datos inválidos.
  const status = r.estado === "invalido" ? 400 : r.estado === "fallido" && r.reintentable ? 502 : 422;

  return NextResponse.json(
    { enviado: false, error: r.motivo, estado: r.estado, mensaje_id: r.mensajeId ?? null },
    { status, headers: noStore },
  );
}
