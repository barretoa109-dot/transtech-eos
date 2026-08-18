import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getPagoparKeys,
  tokenWebhook,
} from "@/lib/pagopar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PagoParResultado = {
  pagado?: boolean;
  cancelado?: boolean;
  numero_comprobante_interno?: string | null;
  ultimo_mensaje_error?: string | null;
  forma_pago?: string | null;
  fecha_pago?: string | null;
  monto?: string | number | null;
  fecha_maxima_pago?: string | null;
  hash_pedido?: string | null;
  numero_pedido?: string | null;
  forma_pago_identificador?: string | null;
  token?: string | null;
};

type PagoParWebhookBody = {
  respuesta?: boolean;
  resultado?: PagoParResultado[];
};

function montoValido(
  recibido: string | number | null | undefined,
  esperado: number,
) {
  const montoRecibido = Number(recibido);

  return (
    Number.isFinite(montoRecibido) &&
    Number.isFinite(esperado) &&
    Math.abs(montoRecibido - esperado) < 0.01
  );
}

function fechaPagoIso(fecha: string | null | undefined) {
  if (!fecha) {
    return new Date().toISOString();
  }

  const fechaNormalizada = fecha
    .trim()
    .replace(" ", "T");

  const conZona =
    /(?:Z|[+-]\d{2}:\d{2})$/.test(fechaNormalizada)
      ? fechaNormalizada
      : `${fechaNormalizada}-03:00`;

  const parsed = new Date(conZona);

  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

export async function POST(request: Request) {
  let body: PagoParWebhookBody | null = null;

  try {
    body = (await request.json()) as PagoParWebhookBody;

    const resultado = body?.resultado?.[0];

    if (
      !body?.respuesta ||
      !resultado ||
      !resultado.hash_pedido ||
      !resultado.token
    ) {
      return NextResponse.json(
        {
          error:
            "La notificación recibida no tiene la estructura esperada.",
        },
        { status: 400 },
      );
    }

    const { privateKey } = getPagoparKeys();

    const tokenEsperado = tokenWebhook(
      privateKey,
      resultado.hash_pedido,
    );

    if (tokenEsperado !== resultado.token) {
      return NextResponse.json(
        {
          error:
            "El token de la notificación no coincide.",
        },
        { status: 401 },
      );
    }

    const admin = createAdminClient();

    const {
      data: solicitud,
      error: solicitudError,
    } = await admin
      .from("solicitudes_pago")
      .select("*")
      .eq(
        "referencia_externa",
        resultado.hash_pedido,
      )
      .maybeSingle();

    if (solicitudError) {
      console.error(
        "Error consultando solicitud:",
        solicitudError,
      );

      return NextResponse.json(
        {
          error:
            "No se pudo consultar la solicitud de pago.",
        },
        { status: 500 },
      );
    }

    if (!solicitud) {
      return NextResponse.json(
        {
          error:
            "No existe una solicitud asociada a este hash.",
        },
        { status: 404 },
      );
    }

    if (
      !montoValido(
        resultado.monto,
        Number(solicitud.monto),
      )
    ) {
      return NextResponse.json(
        {
          error:
            "El monto de la notificación no coincide con el pedido.",
        },
        { status: 400 },
      );
    }

    const estadoEvento = resultado.pagado
      ? "pagado"
      : resultado.cancelado
        ? "cancelado"
        : "reversado";

    const eventoExternoId = [
      resultado.hash_pedido,
      resultado.numero_comprobante_interno ||
        resultado.numero_pedido ||
        "sin-comprobante",
      estadoEvento,
    ].join(":");

    const {
      data: eventoExistente,
      error: eventoExistenteError,
    } = await admin
      .from("eventos_pago")
      .select("id,procesado")
      .eq("proveedor", "pagopar")
      .eq(
        "evento_externo_id",
        eventoExternoId,
      )
      .maybeSingle();

    if (eventoExistenteError) {
      console.error(
        "Error consultando evento:",
        eventoExistenteError,
      );
    }

    if (eventoExistente?.procesado) {
      return NextResponse.json(
        body.resultado,
        { status: 200 },
      );
    }

    let eventoId =
      eventoExistente?.id || null;

    if (!eventoId) {
      const {
        data: eventoCreado,
        error: eventoError,
      } = await admin
        .from("eventos_pago")
        .insert({
          proveedor: "pagopar",
          evento_externo_id:
            eventoExternoId,
          tipo:
            resultado.pagado
              ? "pago_confirmado"
              : resultado.cancelado
                ? "pago_cancelado"
                : "pago_reversado",
          solicitud_pago_id:
            solicitud.id,
          payload: body,
          procesado: false,
        })
        .select("id")
        .single();

      if (eventoError) {
        console.error(
          "No se pudo guardar el evento:",
          eventoError,
        );
      } else {
        eventoId =
          eventoCreado?.id || null;
      }
    }

    if (
      resultado.pagado === true &&
      solicitud.estado !== "pagado"
    ) {
      const duracionDias =
        solicitud.periodicidad === "anual"
          ? 365
          : 30;

      const {
        data: asignacion,
        error: asignacionError,
      } = await admin.rpc(
        "asignar_plan_eos",
        {
          p_usuario_id:
            solicitud.usuario_id,
          p_plan_codigo:
            solicitud.plan_codigo,
          p_duracion_dias:
            duracionDias,
        },
      );

      if (asignacionError) {
        if (eventoId) {
          await admin
            .from("eventos_pago")
            .update({
              error:
                asignacionError.message,
              procesado_at:
                new Date().toISOString(),
            })
            .eq("id", eventoId);
        }

        console.error(
          "No se pudo activar el plan:",
          asignacionError,
        );

        return NextResponse.json(
          {
            error:
              "El pago fue validado, pero no se pudo activar el plan.",
          },
          { status: 500 },
        );
      }

      const pagadoAt = fechaPagoIso(
        resultado.fecha_pago,
      );

      const {
        error: solicitudUpdateError,
      } = await admin
        .from("solicitudes_pago")
        .update({
          estado: "pagado",
          pagado_at: pagadoAt,
          updated_at:
            new Date().toISOString(),
          metadata: {
            ...(solicitud.metadata || {}),
            pagopar_ultimo_evento:
              resultado,
            asignacion_plan:
              asignacion,
          },
        })
        .eq("id", solicitud.id);

      if (solicitudUpdateError) {
        throw solicitudUpdateError;
      }

      const {
        error: historialError,
      } = await admin
        .from("historial_pagos")
        .upsert(
          {
            solicitud_pago_id:
              solicitud.id,
            usuario_id:
              solicitud.usuario_id,
            plan_codigo:
              solicitud.plan_codigo,
            periodicidad:
              solicitud.periodicidad,
            monto:
              solicitud.monto,
            moneda:
              solicitud.moneda,
            proveedor: "pagopar",
            referencia_externa:
              resultado.hash_pedido,
            estado: "pagado",
            pagado_at: pagadoAt,
            metadata: resultado,
          },
          {
            onConflict:
              "proveedor,referencia_externa",
            ignoreDuplicates: false,
          },
        );

      if (historialError) {
        console.error(
          "No se pudo guardar historial:",
          historialError,
        );
      }
    }

    if (
      resultado.cancelado === true &&
      solicitud.estado !== "pagado"
    ) {
      await admin
        .from("solicitudes_pago")
        .update({
          estado: "cancelado",
          updated_at:
            new Date().toISOString(),
          metadata: {
            ...(solicitud.metadata || {}),
            pagopar_ultimo_evento:
              resultado,
          },
        })
        .eq("id", solicitud.id);
    }

    if (
      resultado.pagado === false &&
      resultado.cancelado !== true &&
      solicitud.estado === "pagado"
    ) {
      await admin
        .from("solicitudes_pago")
        .update({
          estado: "reembolsado",
          updated_at:
            new Date().toISOString(),
          metadata: {
            ...(solicitud.metadata || {}),
            pagopar_ultimo_evento:
              resultado,
            observacion:
              "PagoPar notificó una reversión. Revisar manualmente la vigencia del plan.",
          },
        })
        .eq("id", solicitud.id);
    }

    if (eventoId) {
      await admin
        .from("eventos_pago")
        .update({
          procesado: true,
          error: null,
          procesado_at:
            new Date().toISOString(),
        })
        .eq("id", eventoId);
    }

    return NextResponse.json(
      body.resultado,
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "Error en webhook de PagoPar:",
      error,
    );

    return NextResponse.json(
      { error: "No se pudo procesar la notificación." },
      { status: 500 },
    );
  }
}
