import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";

export const dynamic = "force-dynamic";

/** Cuánto para atrás se trae la curva de disponible real: medio año. */
const DIAS_DE_HISTORIA = 182;
/** Cuántos meses de foto de patrimonio se traen. */
const MESES_DE_PATRIMONIO = 12;

type PuntoDisponible = { fecha: string; valor: number | null };
type PuntoPatrimonio = { periodo: string; patrimonio_neto: number | null; moneda: string };

/**
 * "Tu progreso": junta dos series que YA existen, ninguna se inventa acá.
 *
 * Nota de nombre: esta ruta vive en `/api/finanzas/patrimonio-progreso` y no
 * en `/api/finanzas/progreso` porque ese camino ya lo usa "Cómo venís" (días
 * activos) — dos cosas distintas que llegaron el mismo día desde dos
 * sesiones distintas.
 *
 *  - `disponible_real`: la foto diaria que ya guarda `capturarPulsoPersonal`
 *    en `eos_kpi_historia_v105` (id `pers_disponible_real`) — la misma que
 *    usa `/api/finanzas/pulso` para "¿qué cambió?", leída con más días para
 *    atrás porque acá la pregunta es "¿cómo vengo?", no "¿qué cambió hoy?".
 *  - `patrimonio`: la foto MENSUAL nueva (v237, `lib/progreso/snapshot.ts`),
 *    porque patrimonio —a diferencia de disponible real— no se capturaba
 *    en ningún lado hasta ahora.
 */
export async function GET() {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const hoy = hoyEnParaguay();
  const admin = adminSinTipos();
  const supabase = await createClient();

  const [disponibleRes, patrimonioRes] = await Promise.all([
    admin
      .from("eos_kpi_historia_v105")
      .select("fecha,valor")
      .eq("usuario_id", puerta.usuarioId)
      .eq("indicador", "pers_disponible_real")
      .gte("fecha", sumarDias(hoy, -DIAS_DE_HISTORIA))
      .order("fecha", { ascending: true }),
    supabase
      .from("eos_finanzas_progreso_mensual_v237")
      .select("periodo,datos")
      .eq("usuario_id", puerta.usuarioId)
      .order("periodo", { ascending: true })
      .limit(MESES_DE_PATRIMONIO),
  ]);

  if (disponibleRes.error) {
    console.error("Progreso: no se pudo leer la historia de disponible real:", disponibleRes.error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }
  if (patrimonioRes.error) {
    console.error("Progreso: no se pudo leer el patrimonio histórico:", patrimonioRes.error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const disponible_real: PuntoDisponible[] = ((disponibleRes.data ?? []) as { fecha: string; valor: number | null }[]).map(
    (f) => ({ fecha: f.fecha, valor: f.valor === null ? null : Number(f.valor) }),
  );

  const patrimonio: PuntoPatrimonio[] = (
    (patrimonioRes.data ?? []) as { periodo: string; datos: { moneda: string; patrimonio_neto: number | null } }[]
  ).map((f) => ({
    periodo: f.periodo,
    patrimonio_neto: f.datos?.patrimonio_neto ?? null,
    moneda: f.datos?.moneda ?? "PYG",
  }));

  return NextResponse.json(
    { configurado: true, disponible_real, patrimonio },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
