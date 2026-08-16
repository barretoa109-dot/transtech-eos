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

type ErrorRpc = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type CrearPagoRpc = {
  ok?: boolean;
  reused?: boolean;
  solicitud_id?: string;
  referencia?: string;
  monto?: number | string;
  estado?: string;
  vencimiento_pago?: string;
};

const PLANES_PAGOS = new Set(["personal", "pro", "business"]);
const PERIODICIDADES_PAGO = new Set(["mensual", "anual"]);

const CUENTA_DESTINO = {
  banco: "Banco Continental S.A.E.C.A.",
  titular: "TRANSTECH E.A.S.",
  numero_cuenta: "060061320004",
  ruc: "80174259-5",
  moneda: "PYG",
};

function limpiarTexto(valor: unknown, maximo = 180) {
  return String(valor ?? "").trim().slice(0, maximo);
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

  if (texto.includes("EOS_PAYMENT_PLAN_INVALID")) {
    return NextResponse.json(
      { error: "El plan seleccionado no es válido." },
      { status: 400 },
    );
  }

  if (texto.includes("EOS_PAYMENT_PERIOD_INVALID")) {
    return NextResponse.json(
      { error: "La periodicidad seleccionada no es válida." },
      { status: 400 },
    );
  }

  if (texto.includes("EOS_PAYMENT_PLAN_PRICE_INVALID")) {
    return NextResponse.json(
      { error: "El plan no tiene un precio válido." },
      { status: 400 },
    );
  }

  if (texto.includes("EOS_PAYMENT_USER_NOT_FOUND")) {
    return NextResponse.json(
      { error: "No encontramos tu cuenta de TransTech EOS." },
      { status: 409 },
    );
  }

  if (texto.includes("EOS_PAYMENT_ALREADY_IN_REVIEW")) {
    return NextResponse.json(
      {
        error:
          "Ya tenés un comprobante de este plan en revisión. Esperá la validación antes de generar otra solicitud.",
      },
      { status: 409 },
    );
  }

  console.error("No se pudo crear o reutilizar la solicitud:", error);

  return NextResponse.json(
    { error: "No pudimos generar la solicitud de pago." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CrearPagoBody | null;
    const planCodigo = limpiarTexto(body?.plan, 40).toLowerCase();
    const periodicidadEntrada = limpiarTexto(body?.periodicidad, 20).toLowerCase();

    if (!PLANES_PAGOS.has(planCodigo)) {
      return NextResponse.json(
        { error: "El plan seleccionado no es válido." },
        { status: 400 },
      );
    }

    if (periodicidadEntrada && !PERIODICIDADES_PAGO.has(periodicidadEntrada)) {
      return NextResponse.json(
        { error: "La periodicidad seleccionada no es válida." },
        { status: 400 },
      );
    }

    const periodicidad = periodicidadEntrada === "anual" ? "anual" : "mensual";
    const nombre = limpiarTexto(body?.nombre, 120);
    const email = limpiarTexto(body?.email, 180).toLowerCase();
    const telefono = limpiarTexto(body?.telefono, 40);
    const documento = limpiarTexto(body?.documento, 40);
    const ruc = limpiarTexto(body?.ruc, 40);
    const razonSocial = limpiarTexto(body?.razon_social, 160) || nombre;

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

    if (!user.email || user.email.toLowerCase() !== email) {
      return NextResponse.json(
        { error: "El correo debe coincidir con tu cuenta de TransTech EOS." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const comprador = {
      nombre,
      email,
      telefono,
      documento,
      ruc,
      razon_social: razonSocial,
    };

    const { data, error } = await admin.rpc(
      "eos_create_or_reuse_transfer_request_v47",
      {
        p_usuario_id: user.id,
        p_plan_codigo: planCodigo,
        p_periodicidad: periodicidad,
        p_comprador: comprador,
        p_cuenta_destino: CUENTA_DESTINO,
      },
    );

    if (error) {
      return respuestaErrorRpc(error);
    }

    const resultado = (data || {}) as CrearPagoRpc;

    if (
      resultado.ok !== true ||
      !resultado.solicitud_id ||
      !resultado.referencia ||
      !Number.isFinite(Number(resultado.monto))
    ) {
      console.error("RPC v47 devolvió un resultado inesperado:", data);

      return NextResponse.json(
        { error: "No pudimos confirmar la solicitud de pago." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      reutilizada: resultado.reused === true,
      solicitud_id: resultado.solicitud_id,
      referencia: resultado.referencia,
      monto: Number(resultado.monto),
      estado: resultado.estado || "pendiente_transferencia",
      vencimiento_pago: resultado.vencimiento_pago || null,
    });
  } catch (error) {
    console.error("Error creando pago por transferencia:", error);

    return NextResponse.json(
      { error: "No se pudo crear el pedido." },
      { status: 500 },
    );
  }
}
