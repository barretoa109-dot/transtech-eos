import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { miEmpresa } from "@/lib/empresa/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * Quiénes de la empresa pueden ser responsables de un cliente.
 *
 * La política de la tabla de miembros solo deja ver la fila propia, así que se consulta con el
 * cliente de servicio; por eso el filtro por empresa está escrito a mano y es la ÚNICA frontera:
 * la empresa sale de la SESIÓN, nunca de un parámetro. Sin empresa resuelta, solo devuelve a
 * quien pregunta.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET() {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const empresaId = await miEmpresa(await createClient());
  const admin = adminSinTipos();

  let ids: string[] = [puerta.usuarioId];

  if (empresaId) {
    const { data, error } = await admin.from("eos_empresa_miembros").select("usuario_id").eq("empresa_id", empresaId).limit(100);

    if (error) {
      console.error("CRM: no se pudo leer el equipo:", error);
      return NextResponse.json({ error: "No pudimos cargar el equipo." }, { status: 503, headers: noStore });
    }

    ids = Array.from(new Set([puerta.usuarioId, ...((data ?? []) as { usuario_id: string }[]).map((m) => m.usuario_id)]));
  }

  const { data: usuarios } = await admin.from("usuarios").select("id,nombre").in("id", ids);
  const nombres = new Map(((usuarios ?? []) as { id: string; nombre: string | null }[]).map((u) => [u.id, u.nombre]));

  return NextResponse.json(
    {
      equipo: ids.map((id) => ({ id, nombre: nombres.get(id)?.trim() || "Sin nombre", yo: id === puerta.usuarioId })),
    },
    { headers: noStore },
  );
}
