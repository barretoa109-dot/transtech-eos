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

function positiveInteger(value: unknown, max: number) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= max
    ? numeric
    : null;
}

function leaseSeconds(value: unknown) {
  if (value === null || value === undefined || value === "") return 300;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 30 && numeric <= 900
    ? numeric
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

function mapRpcError(error: any) {
  const message = String(error?.message || "");

  if (message.includes("EOS_COMMAND_NOT_FOUND")) {
    return respond({ ok: false, error: "La orden no existe." }, 404);
  }

  if (message.includes("EOS_COMMAND_NOT_AUTHORIZED")) {
    return respond(
      { ok: false, error: "La orden no fue autorizada por Worker Gate." },
      403,
    );
  }

  if (
    message.includes("EOS_COMMAND_STALE_ATTEMPT") ||
    message.includes("EOS_COMMAND_LEASE_EXPIRED") ||
    message.includes("EOS_COMMAND_ATTEMPT_NOT_CLAIMED") ||
    message.includes("EOS_COMMAND_NOT_EXECUTING") ||
    message.includes("EOS_COMMAND_STATE_INVALID")
  ) {
    return respond(
      {
        ok: false,
        error: "El intento ya no posee un lease ejecutable válido.",
      },
      409,
    );
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const authorization = authorized(request);

    if (authorization.unavailable) {
      return respond(
        { ok: false, error: "Gestor de leases del Worker no configurado." },
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
        : "claim";
    const commandId = body?.command_id;
    const requestedLeaseSeconds = leaseSeconds(body?.lease_seconds);

    if (!isUuid(commandId)) {
      return respond({ ok: false, error: "command_id inválido." }, 400);
    }

    if (!requestedLeaseSeconds) {
      return respond(
        { ok: false, error: "lease_seconds debe estar entre 30 y 900." },
        400,
      );
    }

    if (operation !== "claim" && operation !== "renew") {
      return respond({ ok: false, error: "operation inválida." }, 400);
    }

    const admin: any = createAdminClient();

    if (operation === "claim") {
      const { data, error } = await admin.rpc("eos_claim_action_command_v65", {
        p_command_id: commandId,
        p_lease_seconds: requestedLeaseSeconds,
      });

      if (error) {
        const mapped = mapRpcError(error);
        if (mapped) return mapped;
        console.error("Worker action claim RPC error:", error);
        return respond(
          { ok: false, error: "No fue posible reclamar la orden." },
          500,
        );
      }

      const result = data && typeof data === "object" ? data : null;
      if (!result || !isUuid(result.command_id)) {
        console.error("Worker action claim returned invalid data:", result);
        return respond(
          { ok: false, error: "El claim devolvió una respuesta inválida." },
          500,
        );
      }

      return respond({
        ...result,
        operation: "claim",
      });
    }

    const leaseToken = body?.lease_token;
    const attemptCount = positiveInteger(body?.attempt_count, 10);

    if (!isUuid(leaseToken)) {
      return respond({ ok: false, error: "lease_token inválido." }, 400);
    }

    if (!attemptCount) {
      return respond({ ok: false, error: "attempt_count inválido." }, 400);
    }

    const { data, error } = await admin.rpc(
      "eos_renew_action_command_lease_v65",
      {
        p_command_id: commandId,
        p_lease_token: leaseToken,
        p_attempt_count: attemptCount,
        p_lease_seconds: requestedLeaseSeconds,
      },
    );

    if (error) {
      const mapped = mapRpcError(error);
      if (mapped) return mapped;
      console.error("Worker action lease renew RPC error:", error);
      return respond(
        { ok: false, error: "No fue posible renovar el lease." },
        500,
      );
    }

    const result = data && typeof data === "object" ? data : null;
    if (!result || !isUuid(result.command_id) || !isUuid(result.lease_token)) {
      console.error("Worker action renew returned invalid data:", result);
      return respond(
        { ok: false, error: "La renovación devolvió una respuesta inválida." },
        500,
      );
    }

    return respond({
      ...result,
      operation: "renew",
    });
  } catch (error) {
    console.error("Worker action claim unexpected error:", error);
    return respond(
      { ok: false, error: "Error interno del gestor de leases." },
      500,
    );
  }
}
