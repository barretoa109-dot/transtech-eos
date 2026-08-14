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

    if (!conversationId || !requestId || !role || !text) {
      return json({ error: "El mensaje no es válido." }, 400);
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

    const admin = createAdminClient();

    if (replacePrevious) {
      await removePreviousResponses({
        supabase,
        admin,
        userId: user.id,
        conversationId,
        currentRequestId: requestId,
      });
    }

    const { error: insertError } = await admin.from("mensajes").insert({
      usuario_id: user.id,
      conversacion_id: conversationId,
      request_id: requestId,
      rol: role,
      texto: text,
      origen: "eos-web",
      metadata: {
        source: "chat-persistence-v28",
        replace_previous: replacePrevious,
      },
    });

    if (insertError) {
      console.error("No se pudo persistir el turno de chat:", insertError);
      return json({ error: "No se pudo guardar el mensaje." }, 500);
    }

    return json({ ok: true }, 200);
  } catch (error) {
    console.error("Error persistiendo turno de chat:", error);
    return json({ error: "No se pudo guardar el mensaje." }, 500);
  }
}

async function removePreviousResponses({
  supabase,
  admin,
  userId,
  conversationId,
  currentRequestId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  conversationId: string;
  currentRequestId: string;
}) {
  const { data: latestUserMessage, error: latestUserError } = await supabase
    .from("mensajes")
    .select("id,created_at")
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .eq("rol", "usuario")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestUserError) {
    console.error("No se pudo localizar el último turno del usuario:", latestUserError);
    return;
  }

  if (!latestUserMessage?.created_at) return;

  const { data: responseCandidates, error: candidatesError } = await admin
    .from("mensajes")
    .select("id,request_id,created_at")
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .eq("rol", "eos")
    .gt("created_at", latestUserMessage.created_at)
    .order("created_at", { ascending: false })
    .limit(12);

  if (candidatesError) {
    console.error("No se pudieron localizar respuestas anteriores:", candidatesError);
    return;
  }

  const previousIds = (responseCandidates || [])
    .filter((item) => item.request_id !== currentRequestId)
    .map((item) => item.id)
    .filter(Boolean);

  if (previousIds.length === 0) return;

  const { error: deleteError } = await admin
    .from("mensajes")
    .delete()
    .eq("usuario_id", userId)
    .eq("conversacion_id", conversationId)
    .in("id", previousIds);

  if (deleteError) {
    console.error("No se pudieron reemplazar respuestas anteriores:", deleteError);
  }
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
