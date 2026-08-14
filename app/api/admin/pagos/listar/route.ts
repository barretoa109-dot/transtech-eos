import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

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

    const admin: any = createAdminClient();

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

    return NextResponse.json({
      ok: true,
      pagos,
    });
  } catch (error) {
    console.error("Error listando pagos:", error);

    return NextResponse.json(
      { error: "No se pudieron cargar los pagos." },
      { status: 500 },
    );
  }
}
