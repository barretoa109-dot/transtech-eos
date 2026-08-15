import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";

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

function positiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function leaseSeconds(value: unknown) {
  if (value === null || value === undefined || value === "") return 300;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  return Math.max(30, Math.min(900, numeric));
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
      return respond({ ok: false, error: "Lease de acciones no configurado." }, 503);
    }

    if (!authorization.ok) {
      return respond({ ok: false, error: "No autorizado." }, 401);
    }

    const body = await request.json().catch(() => null);
    const operation =
      typeof body?.operation === "string" ? body.operation.trim().toLowerCase() : "";
    const commandId = body?.command_id;
    const seconds = leaseSeconds(body?.lease_seconds);

    if (!isUuid(commandId)) {
      return respond({ ok: false, error: "command_id inválido." }, 400);
    }

    if (!seconds) {
      return respond({ ok: false, error: "lease_seconds inválido." }, 400);
    }

    if (!new Set(["claim", "renew"]).has(operation)) {
      return respond({ ok: false, error: "operation debe ser claim o renew." }, 400);
    }

    const admin: any = createAdminClient();

    if (operation === "claim") {
      const { data, error } = await admin.rpc("eos_claim_action_command_v64", {
        p_command_id: commandId,
        p_lease_seconds: seconds,
      });

      if (error) {
        const message = String(error.message || "");
        if (message.includes("EOS_COMMAND_NOT_FOUND")) {
          return respond({ ok: false, error: "La orden no existe." }, 404);
        }
        if (message.includes("EOS_COMMAND_STATE_INVALID")) {
          return respond({ ok: false, error: "La orden no está en un estado reclamable." }, 409);
        }

        console.error("Worker action lease claim error:", error);
        return respond({ ok: false, error: "No fue posible reclamar la orden." }, 500);
      }

      const result = data && typeof data === "object" ? data : {};
      const claimed = result.claimed === true;
      const hardFailure = result.ok === false;

      return respond(
        {
          ok: !hardFailure,
          claimed,
          execute_effect: claimed,
          idempotent: result.idempotent === true,
          code: result.code ?? null,
          command_id: result.command_id ?? commandId,
          estado: result.estado ?? null,
          attempt_count: result.attempt_count ?? null,
          max_attempts: result.max_attempts ?? null,
          lease_expires_at: result.lease_expires_at ?? null,
          resultado: result.resultado ?? {},
        },
        hardFailure ? 409 : 200,
      );
    }

    const attemptCount = positiveInteger(body?.attempt_count);
    if (!attemptCount) {
      return respond({ ok: false, error: "attempt_count inválido." }, 400);
    }

    const { data, error } = await admin.rpc("eos_renew_action_command_lease_v64", {
      p_command_id: commandId,
      p_attempt_count: attemptCount,
      p_lease_seconds: seconds,
    });

    if (error) {
      const message = String(error.message || "");
      if (message.includes("EOS_COMMAND_NOT_FOUND")) {
        return respond({ ok: false, error: "La orden no existe." }, 404);
      }
      if (
        message.includes("EOS_COMMAND_STALE_ATTEMPT") ||
        message.includes("EOS_COMMAND_NOT_EXECUTING")
      ) {
        return respond({ ok: false, error: "El lease pertenece a otro intento o ya terminó." }, 409);
      }

      console.error("Worker action lease renew error:", error);
      return respond({ ok: false, error: "No fue posible renovar el lease." }, 500);
    }

    const result = data && typeof data === "object" ? data : {};
    return respond({
      ok: true,
      renewed: true,
      command_id: result.command_id ?? commandId,
      estado: result.estado ?? null,
      attempt_count: result.attempt_count ?? attemptCount,
      lease_expires_at: result.lease_expires_at ?? null,
    });
  } catch (error) {
    console.error("Worker action lease unexpected error:", error);
    return respond({ ok: false, error: "Error interno del lease de acciones." }, 500);
  }
}
