import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set([
  "RESPONDER",
  "VER_DASHBOARD",
  "VER_BRIEFING",
  "GUARDAR_MEMORIA",
  "GENERAR_EXCEL",
  "GENERAR_PDF",
  "GENERAR_WORD",
  "CREAR_TAREA",
  "CREAR_OBJETIVO",
]);

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function authorized(request: Request) {
  const expected = process.env.EOS_WORKER_GATE_SECRET;
  if (!expected) return { ok: false, unavailable: true };

  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied) return { ok: false, unavailable: false };

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length) {
    return { ok: false, unavailable: false };
  }

  return {
    ok: timingSafeEqual(expectedBuffer, suppliedBuffer),
    unavailable: false,
  };
}

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  try {
    const authorization = authorized(request);

    if (authorization.unavailable) {
      return respond(
        { ok: false, error: "Worker command broker no configurado." },
        503,
      );
    }

    if (!authorization.ok) {
      return respond({ ok: false, error: "No autorizado." }, 401);
    }

    const body = await request.json().catch(() => null);
    const usuarioId = body?.usuario_id;
    const requestId = body?.request_id;
    const action =
      typeof body?.accion === "string"
        ? body.accion.trim().toUpperCase()
        : "";
    const payload = objectOrNull(body?.payload);
    const conversacionId = body?.conversacion_id ?? null;
    const mensajeId = body?.mensaje_id ?? null;
    const origen =
      typeof body?.origen === "string" && body.origen.trim()
        ? body.origen.trim().slice(0, 120)
        : "eos-worker";

    if (!isUuid(usuarioId) || !isUuid(requestId) || !ACTIONS.has(action)) {
      return respond(
        { ok: false, error: "Solicitud de command broker inválida." },
        400,
      );
    }

    if (!payload) {
      return respond(
        { ok: false, error: "payload debe ser un objeto JSON." },
        400,
      );
    }

    if (conversacionId !== null && !isUuid(conversacionId)) {
      return respond({ ok: false, error: "conversacion_id inválido." }, 400);
    }

    if (mensajeId !== null && !isUuid(mensajeId)) {
      return respond({ ok: false, error: "mensaje_id inválido." }, 400);
    }

    const admin: any = createAdminClient();
    const { data, error } = await admin.rpc(
      "eos_get_or_create_action_command_v61",
      {
        p_usuario_id: usuarioId,
        p_request_id: requestId,
        p_accion: action,
        p_payload: payload,
        p_conversacion_id: conversacionId,
        p_mensaje_id: mensajeId,
        p_origen: origen,
      },
    );

    if (error) {
      const message = String(error.message || "");
      const payloadMismatch = message.includes("EOS_COMMAND_PAYLOAD_MISMATCH");
      const contextMismatch = message.includes("EOS_COMMAND_CONTEXT_MISMATCH");

      if (payloadMismatch || contextMismatch) {
        return respond(
          {
            ok: false,
            error: "La orden existente no coincide exactamente con esta solicitud.",
            code: payloadMismatch
              ? "EOS_COMMAND_PAYLOAD_MISMATCH"
              : "EOS_COMMAND_CONTEXT_MISMATCH",
          },
          409,
        );
      }

      console.error("Worker command broker RPC error:", error);
      return respond(
        { ok: false, error: "No fue posible asegurar la orden ejecutable." },
        500,
      );
    }

    const command = Array.isArray(data) ? data[0] || null : data;
    if (!command || !isUuid(command.command_id)) {
      console.error("Worker command broker returned an invalid row:", command);
      return respond(
        { ok: false, error: "El command broker devolvió una respuesta inválida." },
        500,
      );
    }

    return respond({
      ok: true,
      command_id: command.command_id,
      estado: command.estado,
      idempotent: command.idempotent === true,
      resultado: command.resultado ?? {},
      payload_fingerprint: command.payload_fingerprint ?? null,
    });
  } catch (error) {
    console.error("Worker command broker unexpected error:", error);
    return respond({ ok: false, error: "Error interno del command broker." }, 500);
  }
}
