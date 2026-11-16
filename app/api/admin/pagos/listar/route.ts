import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function correosAdministradores() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function validarAdministrador() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase() || "";

  if (
    error ||
    !user ||
    !email ||
    !correosAdministradores().includes(email)
  ) {
    return null;
  }

  return user;
}

export async function GET() {
  try {
    const administrador = await validarAdministrador();

    if (!administrador) {
      return NextResponse.json(
        { error: "No tenés permiso para acceder a esta sección." },
        { status: 403 },
      );
    }

    const admin = adminSinTipos();

    const { data, error } = await admin
      .from("solicitudes_pago")
      .select(
        "id,usuario_id,plan_codigo,periodicidad,monto,moneda,estado,referencia_interna,metadata,created_at",
      )
      .eq("proveedor", "transferencia")
      .eq("estado", "en_revision")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("No se pudieron listar pagos:", error);

      return NextResponse.json(
        { error: "No se pudieron consultar los pagos pendientes." },
        { status: 500 },
      );
    }

    const pagos = await Promise.all(
      (data || []).map(async (pago: any) => {
        const ruta = pago.metadata?.comprobante?.ruta;
        let comprobanteUrl: string | null = null;

        if (typeof ruta === "string" && ruta.trim()) {
          const { data: signedData, error: signedError } =
            await admin.storage
              .from("comprobantes-pago")
              .createSignedUrl(ruta, 10 * 60);

          if (signedError) {
            console.error(
              `No se pudo firmar el comprobante de la solicitud ${pago.id}:`,
              signedError,
            );
          } else {
            comprobanteUrl = signedData?.signedUrl || null;
          }
        }

        return {
          ...pago,
          comprobante_url: comprobanteUrl,
        };
      }),
    );

    // Lo aprobado hace poco, para poder anularlo si la plata no entró o se
    // aprobó por error. 45 días: un mes de plan y un margen para darse cuenta.
    const desde = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const { data: aprobadosCrudos, error: errorAprobados } = await admin
      .from("solicitudes_pago")
      .select("id,usuario_id,plan_codigo,periodicidad,monto,moneda,estado,referencia_interna,metadata,pagado_at,created_at")
      .eq("proveedor", "transferencia")
      .eq("estado", "pagado")
      .gte("pagado_at", desde)
      .order("pagado_at", { ascending: false })
      .limit(50);

    if (errorAprobados) console.error("No se pudieron listar los pagos aprobados:", errorAprobados);

    // Solo lo que el panel muestra: ni la ruta del comprobante ni la lectura del agente.
    const aprobados = ((aprobadosCrudos ?? []) as Record<string, unknown>[]).map((pago) => {
      const meta = (pago.metadata ?? {}) as Record<string, unknown>;
      const comprador = (meta.comprador ?? {}) as Record<string, unknown>;
      return {
        id: pago.id,
        plan_codigo: pago.plan_codigo,
        periodicidad: pago.periodicidad,
        monto: pago.monto,
        moneda: pago.moneda,
        referencia_interna: pago.referencia_interna,
        pagado_at: pago.pagado_at,
        nombre: typeof comprador.nombre === "string" ? comprador.nombre : null,
        email: typeof comprador.email === "string" ? comprador.email : null,
        activado_por_el_agente: Boolean(meta.autoaprobado_at),
      };
    });

    return NextResponse.json({
      ok: true,
      pagos,
      aprobados,
    });
  } catch (error) {
    console.error("Error listando pagos:", error);

    return NextResponse.json(
      { error: "No se pudieron cargar los pagos." },
      { status: 500 },
    );
  }
}
