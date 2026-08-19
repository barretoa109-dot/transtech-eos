import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Uso real del plan para la tarjeta "Plan y uso" del perfil.
 *
 * `eos_message_usage_v40` está restringida a service_role (RLS activo y sin
 * política para `authenticated`), así que se lee con el admin client pero
 * SIEMPRE filtrando por el usuario de la sesión — nunca por un id que venga
 * del cliente.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStoreHeaders() });
  }

  try {
    const { data: usuario } = await supabase.from("usuarios").select("plan").eq("id", user.id).maybeSingle();

    const planCodigo = normalizarCodigo(usuario?.plan) || "free";

    const { data: plan } = await supabase
      .from("planes")
      .select("codigo,nombre,limite_mensajes,memoria_dias")
      .eq("codigo", planCodigo)
      .maybeSingle();

    // Ventana mensual, mismo formato que usa la cuota: "YYYY-MM".
    const ahora = new Date();
    const windowKey = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, "0")}`;

    const admin = createAdminClient();
    const { data: filas, error: usoError } = await admin
      .from("eos_message_usage_v40")
      .select("cantidad")
      .eq("usuario_id", user.id)
      .eq("quota_scope", "monthly")
      .eq("window_key", windowKey)
      .eq("status", "consumed");

    if (usoError) {
      console.error("No se pudo leer el uso de mensajes:", usoError);
    }

    const usados = ((filas ?? []) as { cantidad: number | null }[]).reduce(
      (total, fila) => total + (Number(fila.cantidad) || 0),
      0,
    );

    return NextResponse.json(
      {
        plan_codigo: planCodigo,
        plan_nombre: plan?.nombre ?? null,
        limite_mensajes: plan?.limite_mensajes ?? null,
        memoria_dias: plan?.memoria_dias ?? null,
        usados,
        window_key: windowKey,
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error("No se pudo cargar el uso del plan:", error);
    return NextResponse.json(
      { error: "No pudimos cargar el uso de tu plan en este momento." },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

function normalizarCodigo(value?: string | null) {
  const codigo = (value || "").trim().toLowerCase().replace(/^eos\s+/, "");
  if (codigo === "inicial") return "personal";
  return codigo;
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
