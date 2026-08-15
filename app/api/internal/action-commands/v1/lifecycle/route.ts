import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Operation = "claim" | "renew" | "finish";

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
}

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders() });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isAttempt(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10;
}

function leaseSeconds(value: unknown) {
  if (value === null || value === undefined || value === "") return 300;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return Math.max(30, Math.min(parsed, 900));
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

function rpcErrorResponse(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  if (message.includes("EOS_COMMAND_NOT_FOUND")) {
    return respond(
      { ok: false, code: "EOS_COMMAND_NOT_FOUND", error: "Orden no encontrada." },
      404,
    );
  }

  if (
    message.includes("EOS_COMMAND_STALE_ATTEMPT") ||
    message.includes("EOS_COMMAND_NOT_EXECUTING") ||
    message.includes("EOS_COMMAND_RESULT_MISMATCH")
  ) {
    const code = message.includes("EOS_COMMAND_STALE_ATTEMPT")
      ? "EOS_COMMAND_STALE_ATTEMPT"
      : message.includes("EOS_COMMAND_RESULT_MISMATCH")
        ? "EOS_COMMAND_RESULT_MISMATCH"
        : "EOS_COMMAND_NOT_EXECUTING";

    return respond(
      {
        ok: false,
        code,
        error: "El intento ya no posee de forma válida esta orden.",
      },
      409,
    );
  }

  if (
    message.includes("EOS_COMMAND_ID_REQUIRED") ||
    message.includes("EOS_COMMAND_LEASE_ARGUMENTS_REQUIRED") ||
    message.includes("EOS_COMMAND_FINISH_ARGUMENTS_REQUIRED")
  ) {
    return respond(
      { ok: false, error: "Solicitud de ciclo de vida inválida." },
      400,
    );
  }

  console.error("Worker command lifecycle RPC error:", error);
  return respond(
    { ok: false, error: "No fue posible actualizar de forma segura la orden." },
    500,
  );
}

function normalizeRpcData(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return objectOrNull(value);
}

export async function POST(request: Request) {
  try {
    const authorization = authorized(request);

    if (authorization.unavailable) {
      return respond(
        { ok: false, error: "Worker command lifecycle no configurado." },
        503,
      );
    }

    if (!authorization.ok) {
      return respond({ ok: false, error: "No autorizado." }, 401);
    }

    const body = await request.json().catch(() => null);
    const operation =
      typeof body?.operation === "string"
        ? body.operation.trim().toLowerCase()
        : "";
    const commandId = body?.command_id;
    const seconds = leaseSeconds(body?.lease_seconds);

    if (
      !(["claim", "renew", "finish"] as string[]).includes(operation) ||
      !isUuid(commandId) ||
      seconds === null
    ) {
      return respond(
        { ok: false, error: "Solicitud de ciclo de vida inválida." },
        400,
      );
    }

    const admin: any = createAdminClient();
    let data: unknown;
    let error: unknown;

    if ((operation as Operation) === "claim") {
      const result = await admin.rpc("eos_claim_action_command_v65", {
        p_command_id: commandId,
        p_lease_seconds: seconds,
      });
      data = result.data;
      error = result.error;
    } else {
      const token = body?.lease_token;
      const attempt = body?.attempt_count;

      if (!isUuid(token) || !isAttempt(attempt)) {
        return respond(
          { ok: false, error: "Token o intento de ejecución inválido." },
          400,
        );
      }

      if ((operation as Operation) === "renew") {
        const result = await admin.rpc("eos_renew_action_command_lease_v65", {
          p_command_id: commandId,
          p_lease_token: token,
          p_attempt_count: attempt,
          p_lease_seconds: seconds,
        });
        data = result.data;
        error = result.error;
      } else {
        if (typeof body?.success !== "boolean") {
          return respond(
            { ok: false, error: "success debe ser booleano para finalizar." },
            400,
          );
        }

        const resultPayload =
          body?.result === null || body?.result === undefined
            ? {}
            : objectOrNull(body.result);

        if (!resultPayload) {
          return respond(
            { ok: false, error: "result debe ser un objeto JSON." },
            400,
          );
        }

        const errorCode =
          typeof body?.error_code === "string"
            ? body.error_code.trim().slice(0, 160) || null
            : null;
        const errorMessage =
          typeof body?.error_message === "string"
            ? body.error_message.trim().slice(0, 2000) || null
            : null;

        const result = await admin.rpc("eos_finish_action_command_v65", {
          p_command_id: commandId,
          p_lease_token: token,
          p_attempt_count: attempt,
          p_success: body.success,
          p_result: resultPayload,
          p_error_code: errorCode,
          p_error_message: errorMessage,
        });
        data = result.data;
        error = result.error;
      }
    }

    if (error) return rpcErrorResponse(error);

    const result = normalizeRpcData(data);
    if (!result || !isUuid(result.command_id)) {
      console.error("Worker command lifecycle returned an invalid payload:", data);
      return respond(
        { ok: false, error: "Respuesta inválida del ciclo de vida de la orden." },
        500,
      );
    }

    return respond(result);
  } catch (error) {
    console.error("Worker command lifecycle unexpected error:", error);
    return respond(
      { ok: false, error: "Error interno del ciclo de vida de la orden." },
      500,
    );
  }
}
