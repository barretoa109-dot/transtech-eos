import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { solicitud_id } = (await request.json()) as {
      solicitud_id?: string;
    };

    if (!solicitud_id) {
      return NextResponse.json(
        { error: "Falta el identificador de la solicitud." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Debés iniciar sesión." },
        { status: 401 },
      );
    }

    const admin: any = createAdminClient();

    const { data: solicitud, error } = await admin
      .from("solicitudes_pago")
      .select(
        "id,plan_codigo,periodicidad,monto,moneda,estado,referencia_interna,pagado_at,created_at",
      )
      .eq("id", solicitud_id)
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (error || !solicitud) {
      if (error) {
        console.error("No se pudo consultar la solicitud de pago:", error);
      }
      return NextResponse.json(
        { error: "No encontramos la solicitud." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, solicitud });
  } catch (error) {
    console.error("Error consultando solicitud de pago:", error);
    return NextResponse.json(
      { error: "No se pudo consultar la solicitud." },
      { status: 500 },
    );
  }
}
