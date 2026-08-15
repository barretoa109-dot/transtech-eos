import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["usuario", "eos"]);
const MAX_REGENERATION_HISTORY = 12;

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
      return persistRegeneratedResponse({
        admin,
        userId: user.id,
        conversationId,
        operationRequestId: requestId,
        targetRequestId: replaceRequestId,
        text,
        messageMetadata,
      });
    }

    return persistRegularMessage({
      admin,
      userId: user.id,
      conversationId,
      requestId,
      role,
      text,
      messageMetadata,
    });
  } catch (error) {
    console.error("Error persistiendo turno de chat:", error);
    return json({ error: "No se pudo guardar el mensaje." }, 500);
  }
}

async function persistRegularMessage({
  admin,
  userId,
  conversationId,
  requestId,
  role,
  text,
  messageMetadata,
}: {
  admin: any;
  userId: string;
  conversationId: string;
  requestId: string;
  role: string;
  text: string;
  messageMetadata: Record<string, unknown>;
}) {
  const metadata = {
    source: "chat-persistence-v30",
    replace_previous: false,
    ...messageMetadata,
  };

  const { error: insertError } = await admin.from("mensajes").insert({
    usuario_id: userId,
    conversacion_id: conversationId,
    request_id: requestId,
    rol: role,
    texto: text,
    origen: "eos-web",
    metadata,
  });

  if (!insertError) {
    return json({ ok: true, idempotent: false }, 200);
  }

  if (insertError.code !== "23505") {
    console.error("No se pudo persistir el turno de chat:", insertError);
    return json({ error: "No se pudo guardar el mensaje." }, 500);
  }

  const { data: existing, error: existingError } = await admin
    .from("mensajes")
    .select("id,conversacion_id,texto,metadata")
    .eq("usuario_id", userId)
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
    !regularReplayMatches(existing.metadata, messageMetadata)
  ) {
    return json(
      {
        error: "El request_id ya fue utilizado con un contenido diferente.",
        code: "EOS_CHAT_REQUEST_CONFLICT",
      },
      409,
    );
  }

  return json({ ok: true, idempotent: true }, 200);
}

async function persistRegeneratedResponse({
  admin,
  userId,
  conversationId,
  operationRequestId,
  targetRequestId,
  text,
  messageMetadata,
}: {
  admin: any;
  userId: string;
  conversationId: string;
  operationRequestId: string;
  targetRequestId: string;
  text: string;
  messageMetadata: Record<string, unknown>;
}) {
  const { data: targetUserMessage, error: targetUserError } = await admin
    .from("mensajes")
    .select("id")
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .eq("request_id", targetRequestId)
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

  const { data: existingResponse, error: existingResponseError } = await admin
    .from("mensajes")
    .select("id,texto,metadata")
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .eq("request_id", targetRequestId)
    .eq("rol", "eos")
    .maybeSingle();

  if (existingResponseError) {
    console.error(
      "No se pudo cargar la respuesta canónica para regenerar:",
      existingResponseError,
    );
    return json({ error: "No se pudo cargar la respuesta anterior." }, 500);
  }

  if (!existingResponse) {
    const metadata = buildRegenerationMetadata({
      previousMetadata: null,
      operationRequestId,
      targetRequestId,
      messageMetadata,
    });

    const { error: insertError } = await admin.from("mensajes").insert({
      usuario_id: userId,
      conversacion_id: conversationId,
      request_id: targetRequestId,
      rol: "eos",
      texto: text,
      origen: "eos-web",
      metadata,
    });

    if (!insertError) {
      return json({ ok: true, idempotent: false, replaced: true }, 200);
    }

    if (insertError.code === "23505") {
      return json(
        {
          error: "Otra regeneración actualizó este turno al mismo tiempo.",
          code: "EOS_CHAT_REGENERATION_CONFLICT",
        },
        409,
      );
    }

    console.error("No se pudo crear la respuesta regenerada:", insertError);
    return json({ error: "No se pudo guardar la respuesta regenerada." }, 500);
  }

  const existingRecord = asRecord(existingResponse.metadata);
  const existingOperationRequestId = isUuid(
    existingRecord.regeneration_request_id,
  )
    ? existingRecord.regeneration_request_id
    : "";
  const existingTargetRequestId = isUuid(existingRecord.replace_request_id)
    ? existingRecord.replace_request_id
    : "";
  const regenerationHistory = readRegenerationHistory(existingRecord);

  if (existingOperationRequestId === operationRequestId) {
    if (
      existingResponse.texto === text &&
      existingTargetRequestId === targetRequestId &&
      sameMessageMetadata(existingRecord, messageMetadata)
    ) {
      return json({ ok: true, idempotent: true, replaced: true }, 200);
    }

    return json(
      {
        error: "La regeneración ya fue registrada con otro contenido.",
        code: "EOS_CHAT_REQUEST_CONFLICT",
      },
      409,
    );
  }

  if (regenerationHistory.includes(operationRequestId)) {
    return json(
      {
        error: "Esta regeneración ya fue reemplazada por una versión más reciente.",
        code: "EOS_CHAT_REGENERATION_SUPERSEDED",
      },
      409,
    );
  }

  const metadata = buildRegenerationMetadata({
    previousMetadata: existingRecord,
    operationRequestId,
    targetRequestId,
    messageMetadata,
  });

  let updateQuery = admin
    .from("mensajes")
    .update({
      texto: text,
      origen: "eos-web",
      metadata,
    })
    .eq("id", existingResponse.id)
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .eq("request_id", targetRequestId)
    .eq("rol", "eos");

  if (existingResponse.metadata == null) {
    updateQuery = updateQuery.is("metadata", null);
  } else {
    updateQuery = updateQuery.eq("metadata", existingResponse.metadata);
  }

  const { data: updated, error: updateError } = await updateQuery
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("No se pudo actualizar la respuesta regenerada:", updateError);
    return json({ error: "No se pudo guardar la respuesta regenerada." }, 500);
  }

  if (!updated) {
    return json(
      {
        error: "Otra regeneración actualizó este turno al mismo tiempo.",
        code: "EOS_CHAT_REGENERATION_CONFLICT",
      },
      409,
    );
  }

  return json({ ok: true, idempotent: false, replaced: true }, 200);
}

function buildRegenerationMetadata({
  previousMetadata,
  operationRequestId,
  targetRequestId,
  messageMetadata,
}: {
  previousMetadata: Record<string, unknown> | null;
  operationRequestId: string;
  targetRequestId: string;
  messageMetadata: Record<string, unknown>;
}) {
  const previousRecord = previousMetadata || {};
  const history = readRegenerationHistory(previousRecord);
  const previousOperationRequestId = isUuid(
    previousRecord.regeneration_request_id,
  )
    ? previousRecord.regeneration_request_id
    : "";

  const nextHistory = Array.from(
    new Set(
      [...history, previousOperationRequestId]
        .filter((value) => isUuid(value))
        .slice(-MAX_REGENERATION_HISTORY),
    ),
  );

  return {
    source: "chat-persistence-v30",
    replace_previous: true,
    replace_request_id: targetRequestId,
    regeneration_request_id: operationRequestId,
    regeneration_history: nextHistory,
    ...messageMetadata,
  };
}

function regularReplayMatches(
  existingMetadata: unknown,
  messageMetadata: Record<string, unknown>,
) {
  const existingRecord = asRecord(existingMetadata);
  const replacePrevious = existingRecord.replace_previous === true;
  const replaceRequestId = isUuid(existingRecord.replace_request_id)
    ? existingRecord.replace_request_id
    : "";

  return (
    !replacePrevious &&
    !replaceRequestId &&
    sameMessageMetadata(existingRecord, messageMetadata)
  );
}

function sameMessageMetadata(
  existingMetadata: unknown,
  messageMetadata: Record<string, unknown>,
) {
  return (
    JSON.stringify(cleanMessageMetadata(existingMetadata)) ===
    JSON.stringify(messageMetadata)
  );
}

function readRegenerationHistory(metadata: unknown) {
  const record = asRecord(metadata);
  const rawHistory = Array.isArray(record.regeneration_history)
    ? record.regeneration_history
    : [];

  return rawHistory
    .filter((value): value is string => isUuid(value))
    .slice(-MAX_REGENERATION_HISTORY);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
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
