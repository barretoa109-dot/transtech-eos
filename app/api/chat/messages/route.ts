import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["usuario", "eos"]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json({ error: "Sesión no válida." }, 401);
    }

    const body = await request.json().catch(() => null);
    const conversationId = isUuid(body?.conversacion_id)
      ? body.conversacion_id
      : "";
    const requestId = isUuid(body?.request_id) ? body.request_id : "";
    const role = VALID_ROLES.has(body?.rol) ? body.rol : "";
    const text = cleanText(body?.texto, 16_000);
    const replacePrevious = body?.reemplazar_anterior === true && role === "eos";
    const replaceRequestId =
      replacePrevious && isUuid(body?.replace_request_id)
        ? body.replace_request_id
        : "";
    const messageMetadata = cleanMessageMetadata(body?.metadata);

    if (!conversationId || !requestId || !role || !text) {
      return json({ error: "El mensaje no es válido." }, 400);
    }

    if (replacePrevious && !replaceRequestId) {
      return json(
        {
          error: "La regeneración no tiene un turno original válido.",
          code: "EOS_CHAT_REGENERATION_TARGET_REQUIRED",
        },
        400,
      );
    }

    if (replacePrevious && replaceRequestId === requestId) {
      return json(
        {
          error: "La regeneración no puede reemplazarse a sí misma.",
          code: "EOS_CHAT_REGENERATION_TARGET_INVALID",
        },
        400,
      );
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversaciones")
      .select("id")
      .eq("id", conversationId)
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (conversationError) {
      console.error("No se pudo validar la conversación:", conversationError);
      return json({ error: "No se pudo validar la conversación." }, 500);
    }

    if (!conversation) {
      return json({ error: "Conversación no encontrada." }, 404);
    }

    const admin = createAdminClient() as any;

    if (replacePrevious) {
      const { data: targetUserMessage, error: targetUserError } = await admin
        .from("mensajes")
        .select("id")
        .eq("usuario_id", user.id)
        .eq("conversacion_id", conversationId)
        .eq("request_id", replaceRequestId)
        .eq("rol", "usuario")
        .maybeSingle();

      if (targetUserError) {
        console.error(
          "No se pudo validar el turno original de regeneración:",
          targetUserError,
        );
        return json(
          { error: "No se pudo validar el turno que querés regenerar." },
          500,
        );
      }

      if (!targetUserMessage) {
        return json(
          {
            error: "El turno original ya no está disponible para regenerar.",
            code: "EOS_CHAT_REGENERATION_TARGET_NOT_FOUND",
          },
          409,
        );
      }
    }

    const metadata = {
      source: "chat-persistence-v29",
      replace_previous: replacePrevious,
      ...(replaceRequestId ? { replace_request_id: replaceRequestId } : {}),
      ...messageMetadata,
    };

    const { error: insertError } = await admin.from("mensajes").insert({
      usuario_id: user.id,
      conversacion_id: conversationId,
      request_id: requestId,
      rol: role,
      texto: text,
      origen: "eos-web",
      metadata,
    });

    if (insertError) {
      if (insertError.code !== "23505") {
        console.error("No se pudo persistir el turno de chat:", insertError);
        return json({ error: "No se pudo guardar el mensaje." }, 500);
      }

      const { data: existing, error: existingError } = await admin
        .from("mensajes")
        .select("id,conversacion_id,texto,metadata")
        .eq("usuario_id", user.id)
        .eq("request_id", requestId)
        .eq("rol", role)
        .maybeSingle();

      if (existingError) {
        console.error("No se pudo verificar replay del turno de chat:", existingError);
        return json({ error: "No se pudo verificar el mensaje existente." }, 500);
      }

      if (
        !existing ||
        existing.conversacion_id !== conversationId ||
        existing.texto !== text ||
        !replayMetadataMatches({
          existingMetadata: existing.metadata,
          messageMetadata,
          replacePrevious,
          replaceRequestId,
        })
      ) {
        return json(
          {
            error: "El request_id ya fue utilizado con un contenido diferente.",
            code: "EOS_CHAT_REQUEST_CONFLICT",
          },
          409,
        );
      }

      if (replacePrevious) {
        const replaced = await removePreviousResponseByRequestId({
          admin,
          userId: user.id,
          conversationId,
          replaceRequestId,
        });

        if (!replaced) {
          await rollbackRegeneratedResponse({
            admin,
            userId: user.id,
            conversationId,
            requestId,
          });

          return json(
            {
              error: "No pudimos completar el reemplazo de la respuesta anterior.",
              code: "EOS_CHAT_REPLACEMENT_INCOMPLETE",
            },
            500,
          );
        }
      }

      return json({ ok: true, idempotent: true }, 200);
    }

    if (replacePrevious) {
      const replaced = await removePreviousResponseByRequestId({
        admin,
        userId: user.id,
        conversationId,
        replaceRequestId,
      });

      if (!replaced) {
        await rollbackRegeneratedResponse({
          admin,
          userId: user.id,
          conversationId,
          requestId,
        });

        return json(
          {
            error: "No pudimos completar el reemplazo de la respuesta anterior.",
            code: "EOS_CHAT_REPLACEMENT_INCOMPLETE",
          },
          500,
        );
      }
    }

    return json({ ok: true, idempotent: false }, 200);
  } catch (error) {
    console.error("Error persistiendo turno de chat:", error);
    return json({ error: "No se pudo guardar el mensaje." }, 500);
  }
}

async function removePreviousResponseByRequestId({
  admin,
  userId,
  conversationId,
  replaceRequestId,
}: {
  admin: any;
  userId: string;
  conversationId: string;
  replaceRequestId: string;
}) {
  const { error: deleteError } = await admin
    .from("mensajes")
    .delete()
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .eq("request_id", replaceRequestId)
    .eq("rol", "eos");

  if (deleteError) {
    console.error("No se pudo reemplazar la respuesta anterior:", deleteError);
    return false;
  }

  return true;
}

async function rollbackRegeneratedResponse({
  admin,
  userId,
  conversationId,
  requestId,
}: {
  admin: any;
  userId: string;
  conversationId: string;
  requestId: string;
}) {
  const { error: rollbackError } = await admin
    .from("mensajes")
    .delete()
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .eq("request_id", requestId)
    .eq("rol", "eos");

  if (rollbackError) {
    console.error(
      "No se pudo revertir la nueva respuesta tras fallar el reemplazo:",
      rollbackError,
    );
  }
}

function replayMetadataMatches({
  existingMetadata,
  messageMetadata,
  replacePrevious,
  replaceRequestId,
}: {
  existingMetadata: unknown;
  messageMetadata: Record<string, unknown>;
  replacePrevious: boolean;
  replaceRequestId: string;
}) {
  const existingRecord =
    existingMetadata && typeof existingMetadata === "object"
      ? (existingMetadata as Record<string, unknown>)
      : {};
  const existingReplacePrevious = existingRecord.replace_previous === true;
  const existingReplaceRequestId = isUuid(existingRecord.replace_request_id)
    ? existingRecord.replace_request_id
    : "";
  const existingMessageMetadata = cleanMessageMetadata(existingRecord);

  return (
    existingReplacePrevious === replacePrevious &&
    existingReplaceRequestId === replaceRequestId &&
    JSON.stringify(existingMessageMetadata) === JSON.stringify(messageMetadata)
  );
}

function cleanMessageMetadata(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  const documentoId = isUuid(record.documento_id) ? record.documento_id : null;
  const documentoNombre = cleanText(record.documento_nombre, 240);
  const imagenNombre = cleanText(record.imagen_nombre, 240);
  const archivoUrl = cleanText(record.archivo_url, 2_048);
  const archivoTipo = cleanText(record.archivo_tipo, 80);
  const archivoNombre = cleanText(record.archivo_nombre, 240);
  const tipo = cleanText(record.tipo, 80);
  const accion = cleanText(record.accion, 120);

  return {
    ...(documentoId ? { documento_id: documentoId } : {}),
    ...(documentoNombre ? { documento_nombre: documentoNombre } : {}),
    ...(imagenNombre ? { imagen_nombre: imagenNombre } : {}),
    ...(archivoUrl ? { archivo_url: archivoUrl } : {}),
    ...(archivoTipo ? { archivo_tipo: archivoTipo } : {}),
    ...(archivoNombre ? { archivo_nombre: archivoNombre } : {}),
    ...(tipo ? { tipo } : {}),
    ...(accion ? { accion } : {}),
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function json(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
    },
  });
}
