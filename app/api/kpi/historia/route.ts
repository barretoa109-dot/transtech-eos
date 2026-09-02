import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { definicion } from "@/lib/kpi/registro";
import { frase, rachaDe, diasSinPoderCalcular, type PuntoHistoria } from "@/lib/kpi/historia";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";

export const dynamic = "force-dynamic";

/**
 * La serie de un indicador: cómo venía, no solo cómo está.
 *
 * Va aparte de `GET /api/kpi` a propósito. El panel pide los 24 indicadores de
 * una y no necesita la historia de ninguno; la historia se pide cuando alguien
 * abre UN indicador. Meterla en la respuesta principal serían 24 series que
 * casi nunca se miran, cargadas en cada visita al dashboard.
 *
 * `?id=margen_bruto&moneda=PYG&dias=60`
 */

/** Un techo para que un `dias` grande no se lleve puesta la respuesta. */
const MAX_DIAS = 365;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") ?? "").trim();
  const moneda = (searchParams.get("moneda") ?? "PYG").trim().toUpperCase();

  const def = definicion(id);
  if (!def) {
    return NextResponse.json({ error: "Ese indicador no existe." }, { status: 404, headers: noStore() });
  }

  const pedidos = Number(searchParams.get("dias") ?? 60);
  const dias = Number.isFinite(pedidos) ? Math.min(Math.max(Math.trunc(pedidos), 2), MAX_DIAS) : 60;

  const hasta = hoyEnParaguay();
  const desde = sumarDias(hasta, -dias);

  /*
   * Se lee con el cliente admin y se filtra por el usuario de la sesión a
   * mano: `adminSinTipos()` usa service_role y NO pasa por RLS. La tabla
   * además tiene su policy de sólo-lectura-propia, así que son dos candados;
   * el de acá es el que no se puede olvidar.
   */
  const { data, error } = await adminSinTipos()
    .from("eos_kpi_historia_v105")
    .select("fecha,valor,confianza,motivo")
    .eq("usuario_id", user.id)
    .eq("indicador", id)
    .eq("moneda", moneda)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: true });

  if (error) {
    console.error("KPI: no se pudo leer la historia:", error);
    return NextResponse.json(
      { error: "No pudimos leer la historia de este indicador." },
      { status: 503, headers: noStore() },
    );
  }

  const puntos: PuntoHistoria[] = (data ?? []).map((f: Record<string, unknown>) => ({
    fecha: String(f.fecha),
    valor: f.valor === null || f.valor === undefined ? null : Number(f.valor),
    confianza: Number(f.confianza ?? 1),
    motivo: (f.motivo as string | null) ?? null,
  }));

  const serie = { indicador: def.id, moneda, unidad: def.unidad, puntos };

  return NextResponse.json(
    {
      serie,
      nombre: def.nombre,
      unidad: def.unidad,
      direccion: def.direccion,
      racha: rachaDe(puntos),
      // La frase es null cuando la serie no alcanza para afirmar nada. Es
      // información: la pantalla no tiene que inventar un texto de relleno.
      frase: frase(serie),
      dias_sin_calcular: diasSinPoderCalcular(puntos),
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
