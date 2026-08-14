import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConsultarPagoBody = {
  solicitud_id?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as ConsultarPagoBody | null;
    const solicitudId = String(body?.solicitud_id || "").trim();

    if (!solicitudId) {
      return NextResponse.json(
        { error: "Falta el identificador de la solicitud." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Debés iniciar sesión." },
        { status: 401 },
      );
    }

    const { data: solicitud, error } = await (supabase as any)
      .from("solicitudes_pago")
      .select(
        "id,plan_codigo,periodicidad,monto,moneda,estado,referencia_interna,pagado_at,created_at",
      )
      .eq("id", solicitudId)
      .maybeSingle();

    if (error) {
      console.error("Error consultando solicitud de pago:", error);

      return NextResponse.json(
        { error: "No pudimos consultar la solicitud." },
        { status: 500 },
      );
    }

    if (!solicitud) {
      return NextResponse.json(
        { error: "No encontramos la solicitud." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, solicitud });
  } catch (error) {
    console.error("Error inesperado consultando solicitud de pago:", error);

    return NextResponse.json(
      { error: "No se pudo consultar la solicitud." },
      { status: 500 },
    );
  }
}
