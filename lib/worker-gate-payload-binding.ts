import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";

const POLICY_VERSION = "eos-worker-gate-v2";

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

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stable((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

function samePayload(left: unknown, right: unknown) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
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

function block(reason: string, status = 409) {
  return NextResponse.json(
    {
      ok: false,
      execute: false,
      decision: "block",
      reason,
      policy_version: POLICY_VERSION,
    },
    { status, headers: noStoreHeaders() },
  );
}

/**
 * Defense-in-depth boundary immediately before the canonical Worker Gate.
 *
 * A command is the idempotent execution anchor from Fase 4. Once command_id
 * exists, the payload presented to the gate must be exactly the JSON payload
 * stored on that command. For explicit approvals the command payload must also
 * be exactly the payload_snapshot the user approved.
 *
 * Returning null means the canonical handler may continue evaluating policy.
 */
export async function validateWorkerGatePayloadBinding(request: Request) {
  const authorization = authorized(request);

  if (authorization.unavailable) {
    return NextResponse.json(
      {
        ok: false,
        execute: false,
        decision: "block",
        error: "Worker gate no configurado.",
      },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  if (!authorization.ok) {
    return NextResponse.json(
      {
        ok: false,
        execute: false,
        decision: "block",
        error: "No autorizado.",
      },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const body = await request.clone().json().catch(() => null);
  const commandId = body?.command_id ?? null;

  // Initial evaluation deliberately happens before a command exists.
  if (commandId === null || commandId === undefined) return null;

  if (!isUuid(commandId)) {
    return NextResponse.json(
      {
        ok: false,
        execute: false,
        decision: "block",
        error: "command_id inválido.",
      },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const usuarioId = body?.usuario_id;
  const requestId = body?.request_id;
  const action = typeof body?.accion === "string" ? body.accion.trim() : "";

  // Let the canonical handler own the normal request-shape error contract.
  if (!isUuid(usuarioId) || !isUuid(requestId) || !action) return null;

  const payload = safeObject(body?.payload);
  const admin: any = createAdminClient();
  const { data: command, error: commandError } = await admin
    .from("eos_action_commands")
    .select("id,usuario_id,request_id,accion,estado,payload")
    .eq("id", commandId)
    .maybeSingle();

  if (commandError) {
    console.error("Worker gate payload binding: no se pudo leer la orden:", commandError);
    return block("No fue posible verificar de forma segura el contenido de la orden.", 500);
  }

  if (!command) {
    return block("command_id no corresponde a una orden existente.", 404);
  }

  if (
    command.usuario_id !== usuarioId ||
    command.request_id !== requestId ||
    command.accion !== action
  ) {
    return block(
      "La orden no coincide exactamente con usuario, request_id y acción evaluados.",
    );
  }

  if (!["recibida", "ejecutando"].includes(command.estado)) {
    return block(`La orden está en estado no ejecutable: ${command.estado}.`);
  }

  if (!samePayload(command.payload, payload)) {
    return block(
      "El payload presentado al Gate no coincide exactamente con el payload de la orden ejecutable.",
    );
  }

  if (body?.consume_approval !== true) return null;

  const approvalId = body?.approval_id;
  if (!isUuid(approvalId)) {
    return NextResponse.json(
      {
        ok: false,
        execute: false,
        decision: "block",
        error: "approval_id inválido.",
      },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data: approval, error: approvalError } = await admin
    .from("eos_action_approvals_v12")
    .select("id,usuario_id,request_id,accion,status,expires_at,payload_snapshot")
    .eq("id", approvalId)
    .maybeSingle();

  if (approvalError) {
    console.error(
      "Worker gate payload binding: no se pudo leer la aprobación:",
      approvalError,
    );
    return block("No fue posible verificar de forma segura la aprobación.", 500);
  }

  if (!approval) {
    return block("La aprobación indicada no existe.", 404);
  }

  if (
    approval.usuario_id !== usuarioId ||
    approval.request_id !== requestId ||
    approval.accion !== action
  ) {
    return block(
      "La aprobación no coincide exactamente con usuario, request_id y acción de la orden.",
    );
  }

  if (approval.status !== "approved") {
    return block(`La aprobación no está disponible para consumo. Estado: ${approval.status}.`);
  }

  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    return block("La aprobación ya venció.");
  }

  if (!samePayload(approval.payload_snapshot, command.payload)) {
    return block(
      "El contenido de la orden ejecutable no coincide exactamente con el payload aprobado por el usuario.",
    );
  }

  return null;
}
