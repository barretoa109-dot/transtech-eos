import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Guardar el EOS que el usuario armó, y decirle cuánto sale.
 *
 * ============================================================
 * EL TOTAL QUE MANDA EL CLIENTE NO SE MIRA
 * ============================================================
 *
 * La pantalla calcula el mismo total mientras el usuario prende y apaga
 * funciones, para que el número cambie sin ir y volver al servidor. Ese número
 * es de adorno: acá se recalcula todo desde cero contra `eos_modulos`, y lo que
 * haya llegado en el cuerpo se descarta sin comparar.
 *
 * No es paranoia: el precio es lo único que separa "elegí estas seis funciones"
 * de "elegí estas seis funciones por mil guaraníes". La cuenta la hace la base
 * (`eos_precio_armado`), que además resuelve las dependencias y los tramos con
 * las mismas reglas para todos los caminos que lleguen a cobrar.
 */

/** Un armado honesto no tiene más ítems que módulos hay. */
const MAX_MODULOS = 40;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const modulos = Array.isArray(cuerpo.modulos)
    ? cuerpo.modulos
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_MODULOS)
    : [];

  if (modulos.length === 0) {
    return NextResponse.json(
      { error: "Elegí al menos una función para armar tu EOS." },
      { status: 400, headers: noStore() },
    );
  }

  const periodicidad = cuerpo.periodicidad === "anual" ? "anual" : "mensual";

  // El cliente tipado no conoce las funciones nuevas; mismo escape que usan
  // las rutas de pagos con sus RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).rpc("eos_guardar_armado", {
    p_usuario_id: user.id,
    p_modulos: modulos,
    p_periodicidad: periodicidad,
  });

  if (error) {
    const texto = String(error.message ?? "");

    if (texto.includes("EOS_ARMADO_VACIO")) {
      return NextResponse.json(
        { error: "Ninguna de las funciones que elegiste está disponible." },
        { status: 400, headers: noStore() },
      );
    }

    console.error("Armado: no se pudo guardar:", error);
    return NextResponse.json(
      { error: "No pudimos guardar tu selección." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json(data, { headers: noStore() });
}

/**
 * Solo el precio, sin guardar nada.
 *
 * Existe para que la pantalla pueda confirmar el total contra el servidor antes
 * de mandar a alguien a pagar, sin dejar un armado pendiente por cada vez que
 * alguien toca un interruptor.
 */
export async function GET(request: Request) {
  const modulos = (new URL(request.url).searchParams.get("modulos") ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_MODULOS);

  if (modulos.length === 0) {
    return NextResponse.json({ error: "Sin funciones." }, { status: 400, headers: noStore() });
  }

  const periodicidad =
    new URL(request.url).searchParams.get("periodicidad") === "anual" ? "anual" : "mensual";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).rpc("eos_precio_armado", {
    p_modulos: modulos,
    p_periodicidad: periodicidad,
  });

  if (error) {
    console.error("Armado: no se pudo calcular el precio:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json(data, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
