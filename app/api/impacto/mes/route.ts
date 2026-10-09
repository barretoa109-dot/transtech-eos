import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos, type ClienteSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay } from "@/lib/fecha";
import { calcularImpacto, lineasDelInforme, mesActual, tieneAlgoQueContar } from "@/lib/impacto/informe";

export const dynamic = "force-dynamic";

/**
 * "Tu mes con EOS": el mismo cálculo que ya usa el correo mensual
 * (`lib/impacto/informe.ts`), del mes EN CURSO y para la pantalla, no del mes
 * cerrado y por correo. Reusa la función pura: los dos lugares tienen que
 * seguir de acuerdo en qué cuenta como "una cosa anotada".
 *
 * Casi todo corre con la sesión de la persona: la RLS de
 * `eos_action_commands` ya aísla cada cuenta, y no hace falta nada de ERP ni
 * de cartera — la pantalla solo muestra acciones, documentos y avisos, no
 * plata. La única excepción es `eos_avisos_historial_v217`: su RLS le
 * revoca todo a `authenticated` a propósito (v217) y solo deja leer a
 * `service_role`, así que esa consulta usa `adminSinTipos()` con
 * `.eq("usuario_id", user.id)` explícito — el filtro que la reemplaza es la
 * única seguridad de esa lectura (`npm run rutas`).
 */
export async function GET() {
  const supabase = (await createClient()) as ClienteSinTipos;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return respuesta("Sesión no válida.", 401);

  const periodo = mesActual(hoyEnParaguay());
  const desde = `${periodo.desde}T00:00:00-03:00`;
  const hasta = `${periodo.hasta}T23:59:59.999-03:00`;

  const admin = adminSinTipos();

  const [acciones, avisos] = await Promise.all([
    supabase
      .from("eos_action_commands")
      .select("accion")
      .eq("usuario_id", user.id)
      .eq("estado", "completada")
      .gte("created_at", desde)
      .lte("created_at", hasta)
      .limit(5000),
    admin
      .from("eos_avisos_historial_v217")
      .select("tipo")
      .eq("usuario_id", user.id)
      .eq("resultado", "entregado")
      .gte("fecha", periodo.desde)
      .lte("fecha", periodo.hasta)
      .limit(1000),
  ]);

  if (acciones.error) {
    console.error("Impacto: no se pudo leer las acciones del mes:", acciones.error);
    return respuesta("No pudimos calcular tu mes con EOS.", 503);
  }
  // Los avisos son un dato de más, no uno sin el cual el resto mienta: si
  // falla, el informe sale sin esa línea (mismo criterio que el correo).
  if (avisos.error) {
    console.error("Impacto: no se pudo leer los avisos del mes:", avisos.error);
  }

  const impacto = calcularImpacto(periodo.clave, {
    acciones: ((acciones.data ?? []) as { accion: string }[]).map((a) => a.accion),
    ventas: [],
    cobrosDeCredito: [],
    porCobrar: [],
    avisos: (avisos.data ?? []) as { tipo: string }[],
  });

  if (!tieneAlgoQueContar(impacto)) {
    return NextResponse.json({ hayImpacto: false }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    {
      hayImpacto: true,
      nombreMes: periodo.nombreMes,
      anotadas: impacto.anotadas,
      documentos: impacto.documentos,
      minutosAhorrados: impacto.minutosAhorrados,
      avisos: impacto.avisos.total,
      lineas: lineasDelInforme(impacto),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
