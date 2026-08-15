import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

type ConsultarPagoBody = {
  solicitud_id?: string;
};

function esUuid(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor,
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as ConsultarPagoBody | null;
    const solicitudId = String(body?.solicitud_id || "").trim();

    if (!solicitudId || !esUuid(solicitudId)) {
      return NextResponse.json(
        { error: "El identificador de la solicitud no es válido." },
        { status: 400, headers: NO_STORE_HEADERS },
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
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { data: solicitud, error } = await (supabase as any)
      .from("solicitudes_pago")
      .select(
        "id,plan_codigo,periodicidad,monto,moneda,estado,referencia_interna,pagado_at,created_at",
      )
      .eq("id", solicitudId)
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Error consultando solicitud de pago:", error);

      return NextResponse.json(
        { error: "No pudimos consultar la solicitud." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (!solicitud) {
      return NextResponse.json(
        { error: "No encontramos la solicitud." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { ok: true, solicitud },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Error inesperado consultando solicitud de pago:", error);

    return NextResponse.json(
      { error: "No se pudo consultar la solicitud." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}