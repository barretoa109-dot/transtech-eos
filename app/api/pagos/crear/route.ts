import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CrearPagoBody = {
  plan?: string;
  periodicidad?: "mensual" | "anual";
  nombre?: string;
  email?: string;
  telefono?: string;
  documento?: string;
  ruc?: string;
  razon_social?: string;
};

const PLANES_PAGOS = new Set(["personal", "pro", "business"]);

function limpiarTexto(valor: unknown, maximo = 180) {
  return String(valor ?? "").trim().slice(0, maximo);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CrearPagoBody;
    const planCodigo = limpiarTexto(body.plan, 40).toLowerCase();
    const periodicidad = body.periodicidad === "anual" ? "anual" : "mensual";

    if (!PLANES_PAGOS.has(planCodigo)) {
      return NextResponse.json(
        { error: "El plan seleccionado no es válido." },
        { status: 400 },
      );
    }

    const nombre = limpiarTexto(body.nombre, 120);
    const email = limpiarTexto(body.email, 180).toLowerCase();
    const telefono = limpiarTexto(body.telefono, 40);
    const documento = limpiarTexto(body.documento, 40);
    const ruc = limpiarTexto(body.ruc, 40);
    const razonSocial = limpiarTexto(body.razon_social, 160) || nombre;

    if (!nombre || !email || !telefono || !documento) {
      return NextResponse.json(
        { error: "Completá nombre, correo, teléfono y documento." },
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
        { error: "Debés iniciar sesión para continuar." },
        { status: 401 },
      );
    }

    if (user.email && user.email.toLowerCase() !== email) {
      return NextResponse.json(
        { error: "El correo debe coincidir con tu cuenta de TransTech EOS." },
        { status: 400 },
      );
    }

    const admin: any = createAdminClient();

    const { data: plan, error: planError } = await admin
      .from("planes")
      .select(
        "id,codigo,nombre,activo,es_publico,precio_mensual_pyg,precio_anual_pyg",
      )
      .eq("codigo", planCodigo)
      .eq("activo", true)
      .eq("es_publico", true)
      .maybeSingle();

    if (planError || !plan) {
      return NextResponse.json(
        { error: "No pudimos consultar el plan seleccionado." },
        { status: 404 },
      );
    }

    const monto =
      periodicidad === "anual"
        ? Number(plan.precio_anual_pyg)
        : Number(plan.precio_mensual_pyg);

    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json(
        { error: "El plan no tiene un precio válido." },
        { status: 400 },
      );
    }

    const referencia = `EOSTR${randomUUID()
      .replaceAll("-", "")
      .slice(0, 18)
      .toUpperCase()}`;

    const { data: solicitud, error: solicitudError } = await admin
      .from("solicitudes_pago")
      .insert({
        usuario_id: user.id,
        plan_codigo: planCodigo,
        periodicidad,
        moneda: "PYG",
        monto,
        proveedor: "transferencia",
        estado: "pendiente_transferencia",
        referencia_interna: referencia,
        vencimiento_pago: new Date(
          Date.now() + 48 * 60 * 60 * 1000,
        ).toISOString(),
        metadata: {
          comprador: {
            nombre,
            email,
            telefono,
            documento,
            ruc,
            razon_social: razonSocial,
          },
          cuenta_destino: {
            banco: "Banco Continental S.A.E.C.A.",
            titular: "TRANSTECH E.A.S.",
            numero_cuenta: "060061320004",
            ruc: "80174259-5",
            moneda: "PYG",
          },
        },
      })
      .select("id,referencia_interna,monto")
      .single();

    if (solicitudError || !solicitud) {
  console.error("No se pudo crear la solicitud:", solicitudError);

  return NextResponse.json(
    {
      error:
        solicitudError?.message ||
        "No pudimos generar la solicitud de pago.",
      details: solicitudError?.details || null,
      hint: solicitudError?.hint || null,
      code: solicitudError?.code || null,
    },
    { status: 500 },
  );
}

    return NextResponse.json({
      ok: true,
      solicitud_id: solicitud.id,
      referencia: solicitud.referencia_interna,
      monto: Number(solicitud.monto),
    });
  } catch (error) {
    console.error("Error creando pago por transferencia:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo crear el pedido.",
      },
      { status: 500 },
    );
  }
}
