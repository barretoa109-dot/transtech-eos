import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { conciliarPendientesBancard } from "@/lib/pagos/conciliacionBancard";
import { consumirCupo, secretoDelEntorno } from "@/lib/seguridad/limite";

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

    const admin = adminSinTipos();

    const leer = () =>
      admin
        .from("solicitudes_pago")
        .select("estado,plan_codigo,metadata,created_at")
        .eq("proveedor", "bancard")
        .eq("referencia_externa", ref)
        .eq("usuario_id", user.id)
        .maybeSingle();

    let { data: solicitud } = await leer();

    /*
     * Si el pago sigue pendiente pasados dos minutos, el webhook no llegó o no
     * se pudo verificar. En vez de dejar al usuario mirando "procesando" hasta
     * que corra el cron, se le pregunta a Bancard ahora. Con techo: la
     * pantalla consulta cada pocos segundos y cada pregunta es una llamada a
     * Bancard.
     */
    if (
      solicitud?.estado === "pendiente" &&
      Date.now() - new Date(solicitud.created_at).getTime() > 2 * 60_000
    ) {
      const cupo = await consumirCupo(admin, {
        ruta: "/api/pagos/bancard/estado#conciliar",
        cabeceras: request.headers,
        ventanaSegundos: 60,
        maximo: 2,
        secreto: secretoDelEntorno(),
      });

      if (cupo.permitido) {
        await conciliarPendientesBancard(admin, { referencia: ref, minutosDeGracia: 2, limite: 1 });
        ({ data: solicitud } = await leer());
      }
    }

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
