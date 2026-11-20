import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { esCodigoPlan } from "@/lib/modulos/planes";

export const dynamic = "force-dynamic";

/**
 * Guardar el plan que el usuario eligió, y decirle cuánto sale.
 *
 * ============================================================
 * SOLO PLANES (v263)
 * ============================================================
 *
 * Desde el 20/11/2026 se venden cuatro planes cerrados y no módulos sueltos.
 * Esta ruta es la única puerta para guardar una compra, así que acá se cierra
 * el armador: llega un código de plan o nada. Una lista de módulos suelta se
 * rechaza, porque cobrarla al precio de cada módulo abriría un camino más
 * barato que los planes (el ERP solo, por ejemplo).
 *
 * El precio lo pone la base (`eos_guardar_paquete_v263`, desde
 * `eos_paquetes`). Un total que llegue en el cuerpo no se mira.
 */
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

  const plan = typeof cuerpo.plan === "string" ? cuerpo.plan.trim().toLowerCase() : "";

  if (!esCodigoPlan(plan)) {
    return NextResponse.json({ error: "Elegí un plan." }, { status: 400, headers: noStore() });
  }

  const periodicidad = cuerpo.periodicidad === "anual" ? "anual" : "mensual";

  // El cliente tipado no conoce las funciones nuevas; mismo escape que usan
  // las rutas de pagos con sus RPC.
  const { data, error } = await adminSinTipos().rpc("eos_guardar_paquete_v263", {
    p_usuario_id: user.id,
    p_paquete: plan,
    p_periodicidad: periodicidad,
  });

  if (error) {
    const texto = String(error.message ?? "");

    if (texto.includes("EOS_PAQUETE_NO_EXISTE") || texto.includes("EOS_PAQUETE_MODULO_INACTIVO")) {
      console.error("Planes: el plan no se puede vender así:", error);
      return NextResponse.json(
        { error: "Ese plan no está disponible en este momento." },
        { status: 400, headers: noStore() },
      );
    }

    console.error("Planes: no se pudo guardar la compra:", error);
    return NextResponse.json(
      { error: "No pudimos guardar tu plan." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json(data, { headers: noStore() });
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
