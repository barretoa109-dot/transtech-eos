import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { POST as runWorkerGate } from "@/lib/worker-gate-handler";
import { validateWorkerGatePayloadBinding } from "@/lib/worker-gate-payload-binding";

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

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: noStoreHeaders(),
  });
}

async function evaluateGate(
  body: Record<string, unknown>,
  authorization: string,
) {
  const request = new Request("http://eos.internal/api/internal/worker-gate/v1", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const blocked = await validateWorkerGatePayloadBinding(request);
  const response = blocked || (await runWorkerGate(request));
  const data = await response
    .clone()
    .json()
    .catch(() => ({
      ok: false,
      execute: false,
      decision: "block",
      error: "Worker Gate devolvió una respuesta no válida.",
    }));

  return { response, data: safeObject(data) };
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") || "";
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Solicitud de autorización inválida.",
        },
        400,
      );
    }

    const source = body as Record<string, unknown>;
    const conversacionId = source.conversacion_id ?? null;
    const mensajeId = source.mensaje_id ?? null;

    if (conversacionId !== null && !isUuid(conversacionId)) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "conversacion_id inválido.",
        },
        400,
      );
    }

    if (mensajeId !== null && !isUuid(mensajeId)) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "mensaje_id inválido.",
        },
        400,
      );
    }

    const initialBody: Record<string, unknown> = {
      usuario_id: source.usuario_id,
      request_id: source.request_id,
      accion: source.accion,
      payload: safeObject(source.payload),
    };

    const initial = await evaluateGate(initialBody, authorization);

    if (!initial.response.ok) {
      return respond(initial.data, initial.response.status);
    }

    if (initial.data.execute === true) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          reason:
            "El Gate intentó habilitar ejecución sin command_id. Se bloqueó por seguridad.",
          policy_version: initial.data.policy_version ?? "eos-worker-gate-v2",
        },
        409,
      );
    }

    const decision = String(initial.data.decision || "block");
    const requiresCommand = initial.data.requires_command === true;
    const approvalReady = decision === "approval_ready";

    if (!(decision === "allow" && requiresCommand) && !approvalReady) {
      return respond({
        ...initial.data,
        execute: false,
        command_created: false,
      });
    }

    const usuarioId = source.usuario_id;
    const requestId = source.request_id;
    const action =
      typeof source.accion === "string"
        ? source.accion.trim().toUpperCase()
        : "";

    if (!isUuid(usuarioId) || !isUuid(requestId) || !action) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Identidad de orden inválida.",
        },
        400,
      );
    }

    const admin: any = createAdminClient();
    const { data: commandData, error: commandError } = await admin.rpc(
      "eos_get_or_create_action_command_v61",
      {
        p_usuario_id: usuarioId,
        p_request_id: requestId,
        p_accion: action,
        p_payload: safeObject(source.payload),
        p_conversacion_id: conversacionId,
        p_mensaje_id: mensajeId,
        p_origen:
          typeof source.origen === "string" && source.origen.trim()
            ? source.origen.trim().slice(0, 120)
            : "eos-worker",
      },
    );

    if (commandError) {
      const message = String(commandError.message || "");
      const payloadMismatch = message.includes("EOS_COMMAND_PAYLOAD_MISMATCH");
      const contextMismatch = message.includes("EOS_COMMAND_CONTEXT_MISMATCH");

      if (payloadMismatch || contextMismatch) {
        return respond(
          {
            ok: false,
            execute: false,
            decision: "block",
            error: "La orden existente no coincide exactamente con esta solicitud.",
            code: payloadMismatch
              ? "EOS_COMMAND_PAYLOAD_MISMATCH"
              : "EOS_COMMAND_CONTEXT_MISMATCH",
          },
          409,
        );
      }

      console.error("Worker authorize command broker error:", commandError);
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "No fue posible asegurar la orden antes de ejecutar.",
        },
        500,
      );
    }

    const command = Array.isArray(commandData)
      ? commandData[0] || null
      : commandData;

    if (!command || !isUuid(command.command_id)) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "El command broker devolvió una orden inválida.",
        },
        500,
      );
    }

    const finalBody: Record<string, unknown> = {
      ...initialBody,
      command_id: command.command_id,
    };

    if (approvalReady) {
      const approval = safeObject(initial.data.approval);
      const approvalId = approval.id;

      if (!isUuid(approvalId)) {
        return respond(
          {
            ok: false,
            execute: false,
            decision: "block",
            error: "La aprobación lista no contiene un approval_id válido.",
          },
          409,
        );
      }

      finalBody.approval_id = approvalId;
      finalBody.consume_approval = true;
    }

    const final = await evaluateGate(finalBody, authorization);

    return respond(
      {
        ...final.data,
        command_id: command.command_id,
        command_idempotent: command.idempotent === true,
        payload_fingerprint: command.payload_fingerprint ?? null,
      },
      final.response.status,
    );
  } catch (error) {
    console.error("Worker authorize unexpected error:", error);
    return respond(
      {
        ok: false,
        execute: false,
        decision: "block",
        error: "Error interno de autorización del Worker.",
      },
      500,
    );
  }
}
