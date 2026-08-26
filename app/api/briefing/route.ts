import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { exigirModulo } from "@/lib/modulos/acceso";

export const dynamic = "force-dynamic";

const BRIEFING_COLUMNS =
  "id,briefing_date,estado,tipo_usuario,saludo,titulo_dia,resumen,enfoque_dia,prioridad_1,prioridad_2,prioridad_3,recomendacion_principal,logros,riesgos,proximos_pasos,fuentes,score,modelo_version,generated_at,created_at,updated_at" as const;

export async function GET() {
  // El briefing es una función que se contrata. `exigirModulo` también
  // resuelve la sesión: sumarle un `getUser()` serían dos validaciones de
  // token por request.
  const puerta = await exigirModulo("briefing");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const user = { id: puerta.usuarioId };

  const { data, error } = await supabase
    .from("eos_daily_briefings")
    .select(BRIEFING_COLUMNS)
    .eq("usuario_id", user.id)
    .not("briefing_date", "is", null)
    .eq("estado", "listo")
    .order("briefing_date", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(7);

  if (error) {
    console.error("No se pudo cargar el briefing diario:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tu briefing en este momento." },
      {
        status: 500,
        headers: noStoreHeaders(),
      },
    );
  }

  const briefings = data ?? [];
  const latest = briefings[0] ?? null;

  return NextResponse.json(
    {
      briefing: latest,
      history: briefings,
      is_stale:
        latest?.briefing_date !== currentDateInParaguay(),
    },
    { headers: noStoreHeaders() },
  );
}

function currentDateInParaguay() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${value.year}-${value.month}-${value.day}`;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  };
}
