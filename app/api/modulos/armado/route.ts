import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { esCodigoPreset } from "@/lib/modulos/presets";

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
  const { data, error } = await adminSinTipos().rpc("eos_guardar_armado", {
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

  await anotarPreset(data, user.id, cuerpo);

  return NextResponse.json(data, { headers: noStore() });
}

/**
 * Desde qué combinación armada se llegó (v193), solo para medir.
 *
 * Va en un update APARTE y después de guardar, a propósito: si falla, el
 * armado y su precio quedan exactamente igual — se pierde el dato de medición,
 * nunca la compra. Un código que no es un preset conocido se ignora.
 */
async function anotarPreset(data: unknown, usuarioId: string, cuerpo: Record<string, unknown>) {
  if (!esCodigoPreset(cuerpo.preset)) return;

  const armadoId =
    data && typeof data === "object" && !Array.isArray(data)
      ? String((data as Record<string, unknown>).armado_id ?? "")
      : "";
  if (!armadoId) return;

  try {
    const { error } = await adminSinTipos()
      .from("eos_planes_armados")
      .update({ preset_origen: cuerpo.preset, preset_editado: cuerpo.preset_editado === true })
      .eq("id", armadoId)
      .eq("usuario_id", usuarioId);

    if (error) console.error("Armado: no se pudo anotar el preset de origen:", error);
  } catch (err) {
    console.error("Armado: no se pudo anotar el preset de origen:", err);
  }
}

/**
 * Un armado YA GUARDADO, para que el checkout pueda mostrar su precio sin
 * recalcularlo.
 *
 * Sale del cliente del USUARIO y no del de servicio a propósito: la política de
 * RLS de `eos_planes_armados` solo deja leer los propios, así que un id ajeno
 * pegado en la URL devuelve vacío en vez del precio de otra persona. El monto
 * que se COBRA tampoco sale de acá: lo vuelve a leer la función de la base al
 * crear la solicitud de pago.
 *
 * ============================================================
 * ACÁ HABÍA UNA CALCULADORA DE PRECIOS SIN SESIÓN
 * ============================================================
 *
 * Un `?modulos=` que devolvía el total de cualquier combinación llamando a
 * `eos_precio_armado` con el cliente de servicio, sin pedir sesión. No filtraba
 * nada —el catálogo y sus precios son públicos— pero no lo usaba nadie: la
 * pantalla calcula el total en el navegador y el que cobra es el POST.
 *
 * Se sacó al encontrarlo probando las rutas en producción, donde era la única
 * que no contestaba 401. Superficie sin dueño que ejecuta una función con rol de
 * servicio: chica hoy, y exactamente la clase de puerta que alguien amplía sin
 * mirar cómo estaba autenticada.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();

  if (!id) {
    return NextResponse.json({ error: "Falta el armado." }, { status: 400, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_planes_armados")
    .select("id,modulos,periodicidad,monto,moneda,estado")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404, headers: noStore() });
  }

  return NextResponse.json(data, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
