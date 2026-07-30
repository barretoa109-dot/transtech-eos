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

function extensionPara(tipo: string) {
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  return "pdf";
}

export async function POST(request: Request) {
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

    const admin: any = createAdminClient();

    const { data: solicitud, error: solicitudError } = await admin
      .from("solicitudes_pago")
      .select("id,usuario_id,estado,metadata")
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

    if (solicitud.estado === "pagado") {
      return NextResponse.json(
        { error: "Esta solicitud ya fue pagada." },
        { status: 409 },
      );
    }

    const extension = extensionPara(archivo.type);
    const ruta = `${user.id}/${solicitudId}/${randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("comprobantes-pago")
      .upload(ruta, bytes, {
        contentType: archivo.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("No se pudo subir el comprobante:", uploadError);

      return NextResponse.json(
        {
          error:
            "No pudimos guardar el comprobante. Verificá que el bucket exista.",
        },
        { status: 500 },
      );
    }

    const metadata = {
      ...(solicitud.metadata || {}),
      comprobante: {
        ruta,
        nombre_original: archivo.name,
        tipo: archivo.type,
        bytes: archivo.size,
        subido_at: new Date().toISOString(),
      },
    };

    const { error: updateError } = await admin
      .from("solicitudes_pago")
      .update({
        estado: "en_revision",
        metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", solicitudId)
      .eq("usuario_id", user.id);

    if (updateError) {
      await admin.storage.from("comprobantes-pago").remove([ruta]);

      return NextResponse.json(
        { error: "No pudimos asociar el comprobante al pedido." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      solicitud_id: solicitudId,
      estado: "en_revision",
    });
  } catch (error) {
    console.error("Error subiendo comprobante:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo subir el comprobante.",
      },
      { status: 500 },
    );
  }
}
