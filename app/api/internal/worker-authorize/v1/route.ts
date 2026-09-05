import { NextResponse } from "next/server";

import { POST as runWorkerGate } from "@/lib/worker-gate-handler";
import { validateWorkerGatePayloadBinding } from "@/lib/worker-gate-payload-binding";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { autorizadoComoWorker } from "@/lib/seguridad/worker-bearer";

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
    const authorizationHeader = request.headers.get("authorization") || "";
    const authorization = autorizadoComoWorker(request);

    if (authorization.unavailable) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Worker Gate no configurado.",
        },
        503,
      );
    }

    if (!authorization.ok) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "No autorizado.",
        },
        401,
      );
    }

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
    const usuarioId = source.usuario_id;
    const requestId = source.request_id;
    const action =
      typeof source.accion === "string"
        ? source.accion.trim().toUpperCase()
        : "";
    const conversacionId = source.conversacion_id ?? null;
    const mensajeId = source.mensaje_id ?? null;
    const payload =
      source.payload === null || source.payload === undefined
        ? {}
        : safeObject(source.payload);

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

    if (
      source.payload !== null &&
      source.payload !== undefined &&
      (typeof source.payload !== "object" || Array.isArray(source.payload))
    ) {
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "payload debe ser un objeto JSON.",
        },
        400,
      );
    }

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

    const admin = adminSinTipos();

    // Retry/resume path. A command that already exists was previously brokered
    // for this exact request/action. We never create a new command here.
    const { data: existingCommand, error: existingCommandError } = await admin
      .from("eos_action_commands")
      .select(
        "id,usuario_id,request_id,accion,estado,payload,resultado,conversacion_id,mensaje_id",
      )
      .eq("usuario_id", usuarioId)
      .eq("request_id", requestId)
      .eq("accion", action)
      .maybeSingle();

    if (existingCommandError) {
      console.error("Worker authorize existing command error:", existingCommandError);
      return respond(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "No fue posible verificar un replay existente.",
        },
        500,
      );
    }

    if (existingCommand) {
      if (!samePayload(existingCommand.payload, payload)) {
        return respond(
          {
            ok: false,
            execute: false,
            decision: "block",
            error: "El replay cambió el payload de la orden original.",
            code: "EOS_COMMAND_PAYLOAD_MISMATCH",
          },
          409,
        );
      }

      if (
        (conversacionId &&
          existingCommand.conversacion_id &&
          conversacionId !== existingCommand.conversacion_id) ||
        (mensajeId &&
          existingCommand.mensaje_id &&
          mensajeId !== existingCommand.mensaje_id)
      ) {
        return respond(
          {
            ok: false,
            execute: false,
            decision: "block",
            error: "El replay cambió el contexto de la orden original.",
            code: "EOS_COMMAND_CONTEXT_MISMATCH",
          },
          409,
        );
      }

      if (existingCommand.estado === "completada") {
        return respond({
          ok: true,
          execute: false,
          decision: "completed",
          reason: "La misma orden ya fue completada; no se repetirá el efecto.",
          command_id: existingCommand.id,
          command_idempotent: true,
          resultado: existingCommand.resultado ?? {},
          policy_version: "eos-worker-gate-v2",
        });
      }

      if (!["recibida", "ejecutando"].includes(existingCommand.estado)) {
        return respond(
          {
            ok: false,
            execute: false,
            decision: "block",
            reason: `La orden existente está en estado no ejecutable: ${existingCommand.estado}.`,
            command_id: existingCommand.id,
          },
          409,
        );
      }

      const { data: priorAuthorization, error: priorAuthorizationError } =
        await admin
          .from("eos_autonomy_events_v12")
          .select("id,event_type,created_at")
          .eq("usuario_id", usuarioId)
          .eq("command_id", existingCommand.id)
          .in("event_type", ["auto_allowed", "consumed"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (priorAuthorizationError) {
        console.error(
          "Worker authorize prior authorization error:",
          priorAuthorizationError,
        );
        return respond(
          {
            ok: false,
            execute: false,
            decision: "block",
            error: "No fue posible verificar la autorización previa del replay.",
          },
          500,
        );
      }

      if (priorAuthorization) {
        return respond({
          ok: true,
          execute: true,
          decision: "allow",
          reason:
            "Replay exacto de una orden ya autorizada; se reanuda el mismo command_id.",
          command_id: existingCommand.id,
          command_idempotent: true,
          resumed: true,
          authorization_event: priorAuthorization.event_type,
          policy_version: "eos-worker-gate-v2",
        });
      }
    }

    const initialBody: Record<string, unknown> = {
      usuario_id: usuarioId,
      request_id: requestId,
      accion: action,
      payload,
    };

    const initial = await evaluateGate(initialBody, authorizationHeader);

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

    const { data: commandData, error: commandError } = await admin.rpc(
      "eos_get_or_create_action_command_v61",
      {
        p_usuario_id: usuarioId,
        p_request_id: requestId,
        p_accion: action,
        p_payload: payload,
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

    if (command.estado === "completada" && command.idempotent === true) {
      return respond({
        ok: true,
        execute: false,
        decision: "completed",
        reason: "La misma orden ya fue completada; no se repetirá el efecto.",
        command_id: command.command_id,
        command_idempotent: true,
        resultado: command.resultado ?? {},
        payload_fingerprint: command.payload_fingerprint ?? null,
        policy_version: "eos-worker-gate-v2",
      });
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

    const final = await evaluateGate(finalBody, authorizationHeader);

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
