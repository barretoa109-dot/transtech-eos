import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Consulta cómo quedó un cobro. Lo usa el checkout al volver del pago
 * ocasional, mientras el webhook de Bancard termina de confirmarlo.
 * Sólo devuelve solicitudes del usuario autenticado.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Debés iniciar sesión." }, { status: 401 });
    }

    const ref = String(
      new URL(request.url).searchParams.get("ref") || "",
    ).trim();

    if (!ref) {
      return NextResponse.json({ error: "Falta la referencia." }, { status: 400 });
    }

    const admin: any = createAdminClient();

    const { data: solicitud } = await admin
      .from("solicitudes_pago")
      .select("estado,plan_codigo,metadata")
      .eq("proveedor", "bancard")
      .eq("referencia_externa", ref)
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (!solicitud) {
      return NextResponse.json(
        { error: "No encontramos ese pago." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      estado: solicitud.estado,
      plan: solicitud.plan_codigo,
      dias_acreditados: solicitud.metadata?.dias_acreditados ?? null,
    });
  } catch (error) {
    console.error("Bancard: error consultando estado:", error);

    return NextResponse.json(
      { error: "No pudimos consultar el pago." },
      { status: 500 },
    );
  }
}
