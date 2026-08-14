import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMO_BYTES = 8 * 1024 * 1024;
const TIPOS_PERMITIDOS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type ErrorRpc = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type AdjuntarComprobanteRpc = {
  ok?: boolean;
  status?: string;
  expired?: boolean;
  solicitud_id?: string;
};

function extensionPara(tipo: string) {
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  return "pdf";
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
      { error: "No encontramos la solicitud de pago." },
      { status: 404 },
    );
  }

  if (texto.includes("EOS_PAYMENT_PROVIDER_INVALID")) {
    return NextResponse.json(
      { error: "La solicitud no corresponde a una transferencia válida." },
      { status: 409 },
    );
  }

  if (texto.includes("EOS_PAYMENT_NOT_AWAITING_TRANSFER")) {
    return NextResponse.json(
      {
        error:
          "Esta solicitud ya fue procesada, venció o ya tiene un comprobante en revisión.",
      },
      { status: 409 },
    );
  }

  if (texto.includes("EOS_PAYMENT_PROOF_ALREADY_ATTACHED")) {
    return NextResponse.json(
      { error: "Esta solicitud ya tiene un comprobante asociado." },
      { status: 409 },
    );
  }

  if (texto.includes("EOS_PAYMENT_PROOF_REQUIRED")) {
    return NextResponse.json(
      { error: "El comprobante no es válido." },
      { status: 400 },
    );
  }

  console.error("No se pudo asociar el comprobante:", error);

  return NextResponse.json(
    { error: "No pudimos asociar el comprobante al pedido." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  let rutaSubida = "";
  let admin: any = null;

  try {
    const formData = await request.formData();
    const solicitudId = String(formData.get("solicitud_id") || "").trim();
    const archivo = formData.get("comprobante");

    if (!solicitudId || !(archivo instanceof File)) {
      return NextResponse.json(
        { error: "Falta la solicitud o el comprobante." },
        { status: 400 },
      );
    }

    if (!TIPOS_PERMITIDOS.has(archivo.type)) {
      return NextResponse.json(
        { error: "El comprobante debe ser JPG, PNG, WEBP o PDF." },
        { status: 400 },
      );
    }

    if (archivo.size <= 0 || archivo.size > MAXIMO_BYTES) {
      return NextResponse.json(
        { error: "El archivo debe pesar menos de 8 MB." },
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
        { error: "Debés iniciar sesión para subir el comprobante." },
        { status: 401 },
      );
    }

    admin = createAdminClient();

    const { data: solicitud, error: solicitudError } = await admin
      .from("solicitudes_pago")
      .select("id,estado,vencimiento_pago")
      .eq("id", solicitudId)
      .eq("usuario_id", user.id)
      .eq("proveedor", "transferencia")
      .maybeSingle();

    if (solicitudError || !solicitud) {
      return NextResponse.json(
        { error: "No encontramos la solicitud de pago." },
        { status: 404 },
      );
    }

    if (solicitud.estado !== "pendiente_transferencia") {
      return NextResponse.json(
        {
          error:
            "Esta solicitud ya fue procesada, venció o ya tiene un comprobante en revisión.",
        },
        { status: 409 },
      );
    }

    if (
      solicitud.vencimiento_pago &&
      new Date(solicitud.vencimiento_pago).getTime() < Date.now()
    ) {
      const { data: expiracion, error: expiracionError } = await admin.rpc(
        "eos_attach_transfer_proof_v46",
        {
          p_solicitud_id: solicitudId,
          p_usuario_id: user.id,
          p_comprobante: {
            intento_vencido: true,
            detectado_at: new Date().toISOString(),
          },
        },
      );

      if (expiracionError) {
        console.error("No se pudo confirmar el vencimiento:", expiracionError);
      }

      const resultadoExpiracion = (expiracion || {}) as AdjuntarComprobanteRpc;

      if (resultadoExpiracion.expired === true || resultadoExpiracion.status === "vencido") {
        return NextResponse.json(
          { error: "Esta solicitud venció. Generá un nuevo pedido para continuar." },
          { status: 409 },
        );
      }
    }

    const extension = extensionPara(archivo.type);
    rutaSubida = `${user.id}/${solicitudId}/${randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("comprobantes-pago")
      .upload(rutaSubida, bytes, {
        contentType: archivo.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("No se pudo subir el comprobante:", uploadError);

      return NextResponse.json(
        { error: "No pudimos guardar el comprobante." },
        { status: 500 },
      );
    }

    const comprobante = {
      ruta: rutaSubida,
      nombre_original: archivo.name.slice(0, 255),
      tipo: archivo.type,
      bytes: archivo.size,
      subido_at: new Date().toISOString(),
    };

    const { data, error } = await admin.rpc("eos_attach_transfer_proof_v46", {
      p_solicitud_id: solicitudId,
      p_usuario_id: user.id,
      p_comprobante: comprobante,
    });

    if (error) {
      await admin.storage.from("comprobantes-pago").remove([rutaSubida]);
      rutaSubida = "";
      return respuestaErrorRpc(error);
    }

    const resultado = (data || {}) as AdjuntarComprobanteRpc;

    if (resultado.expired === true || resultado.status === "vencido") {
      await admin.storage.from("comprobantes-pago").remove([rutaSubida]);
      rutaSubida = "";

      return NextResponse.json(
        { error: "Esta solicitud venció. Generá un nuevo pedido para continuar." },
        { status: 409 },
      );
    }

    if (resultado.ok !== true || resultado.status !== "en_revision") {
      await admin.storage.from("comprobantes-pago").remove([rutaSubida]);
      rutaSubida = "";

      console.error("RPC v46 devolvió un resultado inesperado:", data);

      return NextResponse.json(
        { error: "No pudimos confirmar el comprobante." },
        { status: 500 },
      );
    }

    rutaSubida = "";

    return NextResponse.json({
      ok: true,
      solicitud_id: resultado.solicitud_id || solicitudId,
      estado: "en_revision",
    });
  } catch (error) {
    if (rutaSubida && admin) {
      await admin.storage.from("comprobantes-pago").remove([rutaSubida]);
    }

    console.error("Error subiendo comprobante:", error);

    return NextResponse.json(
      { error: "No se pudo subir el comprobante." },
      { status: 500 },
    );
  }
}
