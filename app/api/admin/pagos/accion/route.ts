import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccionBody = {
  solicitud_id?: string;
  accion?: "aprobar" | "rechazar";
};

type ErrorRpc = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type ProcesarPagoRpc = {
  ok?: boolean;
  status?: string;
  idempotent?: boolean;
  solicitud_id?: string;
  plan_codigo?: string;
  same_plan_renewal?: boolean;
  credited_days?: number;
};

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

function textoErrorRpc(error: unknown) {
  if (!error || typeof error !== "object") return "";

  const detalle = error as ErrorRpc;

  return [detalle.code, detalle.message, detalle.details, detalle.hint]
    .filter((valor): valor is string => typeof valor === "string")
    .join(" ");
}

function respuestaErrorRpc(error: unknown) {
  const texto = textoErrorRpc(error);

  if (texto.includes("EOS_PAYMENT_REQUEST_NOT_FOUND")) {
    return NextResponse.json(
      { error: "No encontramos la solicitud indicada." },
      { status: 404 },
    );
  }

  if (texto.includes("EOS_PAYMENT_REFERENCE_CONFLICT")) {
    return NextResponse.json(
      {
        error:
          "La referencia de esta transferencia ya está asociada a otra solicitud.",
      },
      { status: 409 },
    );
  }

  if (
    texto.includes("EOS_PAYMENT_TERMINAL_CONFLICT") ||
    texto.includes("EOS_PAYMENT_NOT_REVIEWABLE")
  ) {
    return NextResponse.json(
      { error: "La solicitud ya fue procesada o no está en revisión." },
      { status: 409 },
    );
  }

  if (texto.includes("EOS_PAYMENT_PROVIDER_INVALID")) {
    return NextResponse.json(
      { error: "La solicitud no corresponde a una transferencia válida." },
      { status: 409 },
    );
  }

  if (texto.includes("EOS_PAYMENT_PERIOD_INVALID")) {
    return NextResponse.json(
      { error: "La periodicidad del pago no es válida." },
      { status: 409 },
    );
  }

  if (texto.includes("EOS_PAYMENT_USER_NOT_FOUND")) {
    return NextResponse.json(
      { error: "No encontramos el usuario asociado a esta solicitud." },
      { status: 409 },
    );
  }

  console.error("Error RPC procesando pago manual:", error);

  return NextResponse.json(
    { error: "No se pudo procesar el pago." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const administrador = await validarAdministrador();

    if (!administrador) {
      return NextResponse.json(
        { error: "No tenés permiso para realizar esta acción." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as AccionBody | null;
    const solicitudId = String(body?.solicitud_id || "").trim();
    const accion = body?.accion;

    if (!solicitudId || !["aprobar", "rechazar"].includes(accion || "")) {
      return NextResponse.json(
        { error: "La solicitud o la acción no son válidas." },
        { status: 400 },
      );
    }

    const adminEmail = administrador.email?.trim().toLowerCase() || "";

    if (!adminEmail) {
      return NextResponse.json(
        { error: "No tenés permiso para realizar esta acción." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    const { data, error } = await (admin as any).rpc(
      "eos_process_manual_payment_v42",
      {
        p_solicitud_id: solicitudId,
        p_action: accion,
        p_admin_email: adminEmail,
      },
    );

    if (error) {
      return respuestaErrorRpc(error);
    }

    const resultado = (data || {}) as ProcesarPagoRpc;

    if (resultado.ok !== true || !resultado.status) {
      console.error("RPC de pago manual devolvió un resultado inesperado:", data);

      return NextResponse.json(
        { error: "No se pudo confirmar el procesamiento del pago." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      estado: resultado.status,
      idempotente: resultado.idempotent === true,
      solicitud_id: resultado.solicitud_id || solicitudId,
      plan_codigo: resultado.plan_codigo || null,
      renovacion_mismo_plan: resultado.same_plan_renewal === true,
      dias_acreditados: resultado.credited_days || null,
    });
  } catch (error) {
    console.error("Error procesando pago:", error);

    return NextResponse.json(
      { error: "No se pudo procesar el pago." },
      { status: 500 },
    );
  }
}
