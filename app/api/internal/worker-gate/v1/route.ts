import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { POST as runWorkerGate } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRACT_VERSION = "eos-worker-gate-contract-v1";
const POLICY_VERSION = "eos-worker-gate-v1";

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
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

function fingerprint(value: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

async function audit(
  body: Record<string, unknown>,
  responseBody: Record<string, unknown>,
  status: number,
) {
  if (status === 401 || status === 503) return;

  const usuarioId = body.usuario_id;
  const requestId = body.request_id;
  const action = typeof body.accion === "string" ? body.accion.trim() : "";

  if (!isUuid(usuarioId) || !isUuid(requestId) || !action) return;

  try {
    const admin = createAdminClient();
    const approval = safeObject(responseBody.approval);
    const payload = safeObject(body.payload);
    const commandId = isUuid(body.command_id) ? body.command_id : null;
    const requestApprovalId = isUuid(body.approval_id) ? body.approval_id : null;
    const responseApprovalId = isUuid(approval.id) ? approval.id : null;
    const decision =
      typeof responseBody.decision === "string" ? responseBody.decision : "block";
    const reason =
      typeof responseBody.reason === "string"
        ? responseBody.reason
        : typeof responseBody.error === "string"
          ? responseBody.error
          : null;

    const { error } = await admin.from("eos_worker_gate_audit_v15").insert({
      usuario_id: usuarioId,
      request_id: requestId,
      accion: action,
      mode: body.consume_approval === true ? "consume" : "evaluate",
      decision,
      execute: responseBody.execute === true,
      command_id: commandId,
      approval_id: responseApprovalId || requestApprovalId,
      payload_fingerprint: fingerprint(payload),
      contract_version: CONTRACT_VERSION,
      policy_version:
        typeof responseBody.policy_version === "string"
          ? responseBody.policy_version
          : POLICY_VERSION,
      http_status: status,
      reason,
      error_code: status >= 400 ? `WORKER_GATE_HTTP_${status}` : null,
      metadata: {
        idempotent: responseBody.idempotent === true,
        consumed: responseBody.consumed === true,
      },
    });

    if (error) {
      console.error("Worker gate v1: no se pudo registrar auditoría:", error);
    }
  } catch (error) {
    console.error("Worker gate v1: auditoría no disponible:", error);
  }
}

export async function POST(request: Request) {
  const body = safeObject(await request.clone().json().catch(() => null));
  const response = await runWorkerGate(request);
  const raw = await response.text();

  let responseBody: Record<string, unknown>;

  try {
    responseBody = safeObject(JSON.parse(raw));
  } catch {
    responseBody = {
      ok: false,
      execute: false,
      decision: "block",
      error: "Respuesta interna inválida. Ejecución bloqueada por seguridad.",
    };
  }

  const versionedBody = {
    ...responseBody,
    contract_version: CONTRACT_VERSION,
    policy_version:
      typeof responseBody.policy_version === "string"
        ? responseBody.policy_version
        : POLICY_VERSION,
  };

  await audit(body, versionedBody, response.status);

  return NextResponse.json(versionedBody, {
    status: response.status,
    headers: noStoreHeaders(),
  });
}
