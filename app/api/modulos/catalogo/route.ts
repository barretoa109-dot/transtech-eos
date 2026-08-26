import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { TOPE_MENSUAL_PYG, type ModuloCatalogo } from "@/lib/modulos/armado";

export const dynamic = "force-dynamic";

/**
 * La lista de funciones con su precio.
 *
 * ============================================================
 * POR QUÉ ESTA RUTA NO PIDE SESIÓN
 * ============================================================
 *
 * Es la vitrine. Alguien que todavía no tiene cuenta tiene que poder ver qué
 * ofrece EOS y cuánto sale antes de registrarse — obligarlo a crear una cuenta
 * para conocer el precio es la manera más rápida de que se vaya.
 *
 * Que no pida sesión no la vuelve laxa: devuelve **solo el catálogo**, sin una
 * sola fila de nadie. Y usa el cliente de servicio porque la política de RLS de
 * `eos_modulos` deja leer a `authenticated` y no a `anon`; el filtro de qué es
 * público se hace acá, explícito, sobre las mismas dos condiciones que usa la
 * política: `activo` y `es_publico`.
 *
 * Un módulo interno del ecosistema TransTech —activo pero no público— no
 * aparece. Existe, funciona, no se vende.
 */

const COLUMNAS =
  "codigo,nombre,descripcion,precio_mensual_pyg,precio_anual_pyg,grupo,limite_mensajes,requiere,orden";

export async function GET() {
  let filas: Record<string, unknown>[] = [];

  try {
    const { data, error } = await createAdminClient()
      .from("eos_modulos")
      .select(COLUMNAS)
      .eq("activo", true)
      .eq("es_publico", true)
      .order("orden", { ascending: true });

    if (error) throw error;
    filas = (data ?? []) as Record<string, unknown>[];
  } catch (error) {
    console.error("Módulos: no se pudo leer el catálogo público:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: cache(0) });
  }

  const modulos: ModuloCatalogo[] = filas.map((m) => ({
    codigo: String(m.codigo),
    nombre: String(m.nombre),
    descripcion: (m.descripcion as string | null) ?? null,
    precio_mensual_pyg: Number(m.precio_mensual_pyg ?? 0),
    precio_anual_pyg: Number(m.precio_anual_pyg ?? 0),
    grupo: (m.grupo as string | null) ?? null,
    limite_mensajes:
      m.limite_mensajes === null || m.limite_mensajes === undefined
        ? null
        : Number(m.limite_mensajes),
    requiere: Array.isArray(m.requiere) ? (m.requiere as string[]) : [],
    orden: Number(m.orden ?? 100),
  }));

  return NextResponse.json(
    { modulos, tope_mensual_pyg: TOPE_MENSUAL_PYG },
    // Una lista de precios sí se puede cachear: es la misma para todos y no
    // cambia varias veces por día. Cinco minutos alcanzan para que un cambio de
    // precio se vea enseguida sin pegarle a la base en cada visita.
    { headers: cache(300) },
  );
}

function cache(segundos: number) {
  return segundos > 0
    ? { "Cache-Control": `public, max-age=60, s-maxage=${segundos}, stale-while-revalidate=600` }
    : { "Cache-Control": "no-store" };
}
