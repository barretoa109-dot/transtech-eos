import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { sincronizarPlantilla } from "@/lib/whatsapp-crm/plantillas";

export const dynamic = "force-dynamic";

/**
 * Trae de Meta el estado actual de una plantilla. Meta avisa por el webhook cuando
 * la revisa, pero el aviso puede perderse (un despliegue, una caída): esto es el
 * plan B, a un clic de distancia.
 */
export async function POST(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  const noStore = { "Cache-Control": "private, no-store, max-age=0" };

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404, headers: noStore });
  }

  const r = await sincronizarPlantilla(adminSinTipos(), puerta.usuarioId, id);

  return r.ok
    ? NextResponse.json({ plantilla: r.plantilla }, { headers: noStore })
    : NextResponse.json({ error: r.error }, { status: r.estado, headers: noStore });
}
