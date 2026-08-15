import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATES = new Set([
  "completada",
  "error",
  "no_disponible",
  "cancelada",
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

function positiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
        { ok: false, error: "Finalizador de acciones no configurado." },
        503,
      );
    }

    if (!authorization.ok) {
      return respond({ ok: false, error: "No autorizado." }, 401);
    }

    const body = await request.json().catch(() => null);
    const commandId = body?.command_id;
    const attemptCount = positiveInteger(body?.attempt_count);
    const estado = cleanText(body?.estado, 40).toLowerCase();
    const resultado = objectOrEmpty(body?.resultado);
    const errorCode = cleanText(body?.error_code, 160) || null;
    const errorMessage = cleanText(body?.error_message, 500) || null;

    if (!isUuid(commandId)) {
      return respond({ ok: false, error: "command_id inválido." }, 400);
    }

    if (!attemptCount) {
      return respond({ ok: false, error: "attempt_count inválido." }, 400);
    }

    if (!TERMINAL_STATES.has(estado)) {
      return respond({ ok: false, error: "Estado terminal inválido." }, 400);
    }

    const admin: any = createAdminClient();
    const { data, error } = await admin.rpc(
      "eos_finalize_action_command_v68",
      {
        p_command_id: commandId,
        p_attempt_count: attemptCount,
        p_estado: estado,
        p_resultado: resultado,
        p_error_code: errorCode,
        p_error_message: errorMessage,
      },
    );

    if (error) {
      const message = String(error.message || "");

      if (message.includes("EOS_ACTION_COMMAND_NOT_FOUND")) {
        return respond({ ok: false, error: "La orden no existe." }, 404);
      }

      if (message.includes("EOS_ACTION_COMMAND_NOT_AUTHORIZED")) {
        return respond(
          { ok: false, error: "La orden no fue autorizada por Worker Gate." },
          403,
        );
      }

      if (message.includes("EOS_ACTION_COMMAND_NOT_CLAIMED")) {
        return respond(
          { ok: false, error: "La orden no fue reclamada por un Worker antes del efecto." },
          409,
        );
      }

      if (message.includes("EOS_ACTION_STALE_ATTEMPT")) {
        return respond(
          { ok: false, error: "El resultado pertenece a un intento stale y fue rechazado." },
          409,
        );
      }

      if (
        message.includes("EOS_ACTION_TERMINAL_CONFLICT") ||
        message.includes("EOS_ACTION_COMMAND_NOT_EXECUTABLE") ||
        message.includes("EOS_ACTION_TERMINAL_EVENT_NOT_APPLIED")
      ) {
        return respond(
          { ok: false, error: "La orden tiene un resultado o estado incompatible." },
          409,
        );
      }

      console.error("Worker action finalizer RPC error:", error);
      return respond(
        { ok: false, error: "No fue posible cerrar la orden de forma segura." },
        500,
      );
    }

    const result = Array.isArray(data) ? data[0] || null : data;
    if (!result || !isUuid(result.command_id)) {
      console.error("Worker action finalizer returned an invalid row:", result);
      return respond(
        { ok: false, error: "El finalizador devolvió una respuesta inválida." },
        500,
      );
    }

    return respond({
      ok: true,
      command_id: result.command_id,
      attempt_count: attemptCount,
      estado: result.estado,
      idempotent: result.idempotent === true,
      resultado: result.resultado ?? {},
      completed_at: result.completed_at ?? null,
    });
  } catch (error) {
    console.error("Worker action finalizer unexpected error:", error);
    return respond(
      { ok: false, error: "Error interno del finalizador de acciones." },
      500,
    );
  }
}
