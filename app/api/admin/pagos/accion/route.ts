import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccionBody = {
  solicitud_id?: string;
  accion?: "aprobar" | "rechazar";
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

export async function POST(request: Request) {
  try {
    const administrador = await validarAdministrador();

    if (!administrador) {
      return NextResponse.json(
        { error: "No tenés permiso para realizar esta acción." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as AccionBody;
    const solicitudId = String(body.solicitud_id || "").trim();
    const accion = body.accion;

    if (!solicitudId || !["aprobar", "rechazar"].includes(accion || "")) {
      return NextResponse.json(
        { error: "La solicitud o la acción no son válidas." },
        { status: 400 },
      );
    }

    const admin: any = createAdminClient();

    const { data: solicitud, error: solicitudError } = await admin
      .from("solicitudes_pago")
      .select("*")
      .eq("id", solicitudId)
      .eq("proveedor", "transferencia")
      .maybeSingle();

    if (solicitudError || !solicitud) {
      return NextResponse.json(
        { error: "No encontramos la solicitud indicada." },
        { status: 404 },
      );
    }

    if (solicitud.estado !== "en_revision") {
      return NextResponse.json(
        {
          error:
            "La solicitud ya fue procesada o no se encuentra en revisión.",
        },
        { status: 409 },
      );
    }

    if (accion === "rechazar") {
      const { error: rechazoError } = await admin
        .from("solicitudes_pago")
        .update({
          estado: "rechazado",
          updated_at: new Date().toISOString(),
          metadata: {
            ...(solicitud.metadata || {}),
            revision_manual: {
              accion: "rechazado",
              administrador_id: administrador.id,
              administrador_email: administrador.email,
              fecha: new Date().toISOString(),
            },
          },
        })
        .eq("id", solicitud.id)
        .eq("estado", "en_revision");

      if (rechazoError) {
        throw rechazoError;
      }

      return NextResponse.json({
        ok: true,
        estado: "rechazado",
      });
    }

    const duracionDias = solicitud.periodicidad === "anual" ? 365 : 30;

    const { data: asignacion, error: asignacionError } = await admin.rpc(
      "asignar_plan_eos",
      {
        p_usuario_id: solicitud.usuario_id,
        p_plan_codigo: solicitud.plan_codigo,
        p_duracion_dias: duracionDias,
      },
    );

    if (asignacionError) {
      console.error("No se pudo activar el plan:", asignacionError);

      return NextResponse.json(
        {
          error:
            "El comprobante fue aceptado, pero no se pudo activar el plan.",
        },
        { status: 500 },
      );
    }

    const pagadoAt = new Date().toISOString();

    const { error: updateError } = await admin
      .from("solicitudes_pago")
      .update({
        estado: "pagado",
        pagado_at: pagadoAt,
        updated_at: pagadoAt,
        metadata: {
          ...(solicitud.metadata || {}),
          revision_manual: {
            accion: "aprobado",
            administrador_id: administrador.id,
            administrador_email: administrador.email,
            fecha: pagadoAt,
          },
          asignacion_plan: asignacion,
        },
      })
      .eq("id", solicitud.id)
      .eq("estado", "en_revision");

    if (updateError) {
      throw updateError;
    }

    const referenciaExterna = solicitud.referencia_interna;

    const { error: historialError } = await admin
      .from("historial_pagos")
      .upsert(
        {
          solicitud_pago_id: solicitud.id,
          usuario_id: solicitud.usuario_id,
          plan_codigo: solicitud.plan_codigo,
          periodicidad: solicitud.periodicidad,
          monto: solicitud.monto,
          moneda: solicitud.moneda,
          proveedor: "transferencia",
          referencia_externa: referenciaExterna,
          estado: "pagado",
          pagado_at: pagadoAt,
          metadata: {
            revision_manual: true,
            administrador_email: administrador.email,
          },
        },
        {
          onConflict: "proveedor,referencia_externa",
          ignoreDuplicates: false,
        },
      );

    if (historialError) {
      console.error(
        "El plan se activó pero no se guardó el historial:",
        historialError,
      );
    }

    return NextResponse.json({
      ok: true,
      estado: "pagado",
    });
  } catch (error) {
    console.error("Error procesando pago:", error);

    return NextResponse.json(
      { error: "No se pudo procesar el pago." },
      { status: 500 },
    );
  }
}
