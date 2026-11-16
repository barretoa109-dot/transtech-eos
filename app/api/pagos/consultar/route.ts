import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enviarCorreoSimple } from "@/lib/email/enviar-simple";
import { enviarConfirmacionPlan } from "@/lib/email/transaccionales";
import { autoaprobarSiCorresponde } from "@/lib/pagos/agente-transferencias";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

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

    // La pantalla de espera consulta cada pocos segundos: ese mismo pedido es
    // el reloj del agente. Si el comprobante coincide y el dueño no contestó a
    // tiempo, se activa acá, sin depender de un cron que puede atrasarse.
    if (solicitud.estado === "en_revision") {
      after(async () => {
        try {
          const admin = adminSinTipos();
          const r = await autoaprobarSiCorresponde(admin, solicitud.id, {
            enviarCorreo: enviarCorreoSimple(),
            baseUrl: new URL(request.url).origin,
          });
          if (r.activado && r.usuarioId && r.planCodigo) {
            await enviarConfirmacionPlan(admin, {
              usuarioId: r.usuarioId,
              planCodigo: r.planCodigo,
              referencia: solicitud.id,
              renovacion: false,
            });
          }
        } catch (error) {
          console.error("Pagos: falló la aprobación automática:", error);
        }
      });
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
