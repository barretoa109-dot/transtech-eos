import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { crearPlantilla, validarPlantilla } from "@/lib/whatsapp-crm/plantillas";

export const dynamic = "force-dynamic";

/**
 * Las plantillas de mensaje del WhatsApp de la empresa.
 *
 * GET   la lista, con el estado que le dio Meta. Se lee con la sesión: la RLS de la
 *       v177 decide qué se ve.
 * POST  crea una y la manda a revisión de Meta (`lib/whatsapp-crm/plantillas.ts`).
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("eos_wa_plantillas")
    .select("id,canal_id,nombre,idioma,categoria,cuerpo,cantidad_variables,estado,motivo_rechazo,creado_en")
    .order("creado_en", { ascending: false })
    .limit(100);

  if (error) {
    // La tabla todavía no existe (v177 sin aplicar): no es un error, es "no hay".
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ plantillas: [] }, { headers: noStore });
    }
    console.error("CRM WhatsApp: no se pudieron leer las plantillas:", error);
    return NextResponse.json({ error: "No pudimos cargar las plantillas." }, { status: 500, headers: noStore });
  }

  return NextResponse.json({ plantillas: data ?? [] }, { headers: noStore });
}

export async function POST(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore });
  }

  const canalId = String(cuerpo.canal_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(canalId)) {
    return NextResponse.json({ error: "Canal no encontrado." }, { status: 404, headers: noStore });
  }

  const validacion = validarPlantilla(cuerpo);
  if (!validacion.ok) {
    return NextResponse.json({ error: validacion.error, campo: validacion.campo }, { status: 400, headers: noStore });
  }

  const r = await crearPlantilla(adminSinTipos(), puerta.usuarioId, canalId, validacion.datos);

  return r.ok
    ? NextResponse.json({ plantilla: r.plantilla }, { status: 201, headers: noStore })
    : NextResponse.json({ error: r.error, campo: r.campo }, { status: r.estado, headers: noStore });
}
