import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { autorizadoComoWorker } from "@/lib/seguridad/worker-bearer";
import { paraRegistro } from "@/lib/seguridad/registro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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



function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders() });
}

function mapRpcError(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  if (message.includes("EOS_INTERNAL_EFFECT_COMMAND_NOT_FOUND")) {
    return respond(
      {
        ok: false,
        code: "EOS_INTERNAL_EFFECT_COMMAND_NOT_FOUND",
        error: "La orden no existe.",
      },
      404,
    );
  }

  if (message.includes("EOS_INTERNAL_EFFECT_NOT_AUTHORIZED")) {
    return respond(
      {
        ok: false,
        code: "EOS_INTERNAL_EFFECT_NOT_AUTHORIZED",
        error: "La orden no fue autorizada por Worker Gate.",
      },
      403,
    );
  }

  if (message.includes("EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION")) {
    return respond(
      {
        ok: false,
        code: "EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION",
        error: "La acción no pertenece al ejecutor interno.",
      },
      400,
    );
  }

  if (message.includes("EOS_ACTION_AUTONOMY_DISABLED")) {
    return respond(
      {
        ok: false,
        code: "EOS_ACTION_AUTONOMY_DISABLED",
        error: "La autonomía está desactivada para este usuario.",
      },
      409,
    );
  }

  if (message.includes("EOS_ACTION_RULE_DISABLED")) {
    return respond(
      {
        ok: false,
        code: "EOS_ACTION_RULE_DISABLED",
        error: "La regla de autonomía está desactivada para esta acción.",
      },
      409,
    );
  }

  if (message.includes("EOS_ACTION_CONTEXT_STALE")) {
    return respond(
      {
        ok: false,
        code: "EOS_ACTION_CONTEXT_STALE",
        error: "El Contexto Maestro debe actualizarse antes de ejecutar esta acción.",
      },
      409,
    );
  }

  if (
    message.includes("EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE") ||
    message.includes("EOS_INTERNAL_EFFECT_GOAL_FAILED") ||
    message.includes("EOS_INTERNAL_EFFECT_GOAL_ID_MISSING")
  ) {
    const code = message.includes("EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE")
      ? "EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE"
      : message.includes("EOS_INTERNAL_EFFECT_GOAL_FAILED")
        ? "EOS_INTERNAL_EFFECT_GOAL_FAILED"
        : "EOS_INTERNAL_EFFECT_GOAL_ID_MISSING";

    return respond(
      {
        ok: false,
        code,
        error: "La orden no pudo ejecutarse de forma segura.",
      },
      409,
    );
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const authorization = autorizadoComoWorker(request);

    if (authorization.unavailable) {
      return respond(
        { ok: false, error: "Worker effect executor no configurado." },
        503,
      );
    }

    if (!authorization.ok) {
      return respond({ ok: false, error: "No autorizado." }, 401);
    }

    const body = await request.json().catch(() => null);
    const commandId = body?.command_id;

    if (!isUuid(commandId)) {
      return respond({ ok: false, error: "command_id inválido." }, 400);
    }

    const admin = adminSinTipos();
    const { data, error } = await admin.rpc(
      "eos_execute_internal_effect_v64",
      { p_command_id: commandId },
    );

    if (error) {
      const mapped = mapRpcError(error);
      if (mapped) return mapped;

      console.error("Worker effect executor RPC error:", error);
      return respond(
        { ok: false, error: "No fue posible ejecutar el efecto interno." },
        500,
      );
    }

    const effect = Array.isArray(data) ? data[0] || null : data;

    if (!effect || !isUuid(effect.command_id) || !isUuid(effect.effect_id)) {
      // Sin el payload: la fila trae adentro lo que el usuario pidió hacer.
      console.error("Worker effect executor returned an invalid row:", paraRegistro(effect));
      return respond(
        { ok: false, error: "El ejecutor devolvió una respuesta inválida." },
        500,
      );
    }

    return respond({
      ok: true,
      command_id: effect.command_id,
      accion: effect.accion,
      effect_type: effect.effect_type,
      effect_id: effect.effect_id,
      idempotent: effect.idempotent === true,
      estado: effect.estado,
      resultado: effect.resultado ?? {},
    });
  } catch (error) {
    console.error("Worker effect executor unexpected error:", error);
    return respond(
      { ok: false, error: "Error interno del ejecutor de efectos." },
      500,
    );
  }
}
