import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

function buscarTexto(valor: unknown): string {
  if (!valor) return "";

  if (typeof valor === "string") return valor;

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = buscarTexto(item);
      if (encontrado) return encontrado;
    }
  }

  if (typeof valor === "object") {
    const registro = valor as Record<string, unknown>;
    const campos = [
      "respuesta",
      "text",
      "message",
      "output",
      "content",
      "data",
      "body",
      "json",
    ];

    for (const campo of campos) {
      const encontrado = buscarTexto(registro[campo]);
      if (encontrado) return encontrado;
    }

    for (const key of Object.keys(registro)) {
      const encontrado = buscarTexto(registro[key]);
      if (encontrado) return encontrado;
    }
  }

  return "";
}

function limpiarRespuesta(texto: string): string {
  return texto
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

function esUuid(valor: unknown): valor is string {
  return (
    typeof valor === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)
  );
}

function textoSeguro(valor: unknown, max = 500) {
  return typeof valor === "string"
    ? valor.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  };
}

export async function POST(req: Request) {
  let releaseReservedQuota: ((reason: string) => Promise<void>) | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        {
          respuesta: "Tu sesión dejó de ser válida. Iniciá sesión nuevamente.",
        },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const conversacionId = textoSeguro(body.conversacion_id, 120);

    if (conversacionId) {
      if (!esUuid(conversacionId)) {
        return Response.json(
          { respuesta: "La conversación indicada no es válida." },
          { status: 400, headers: noStoreHeaders() },
        );
      }

      const { data: conversacion, error: conversationError } = await supabase
        .from("conversaciones")
        .select("id")
        .eq("id", conversacionId)
        .eq("usuario_id", user.id)
        .maybeSingle();

      if (conversationError) {
        console.error("No se pudo verificar la conversación EOS:", conversationError);
        return Response.json(
          {
            respuesta:
              "No pudimos verificar esta conversación de forma segura. Probá nuevamente.",
          },
          { status: 503, headers: noStoreHeaders() },
        );
      }

      if (!conversacion) {
        return Response.json(
          { respuesta: "La conversación no pertenece a tu sesión actual." },
          { status: 403, headers: noStoreHeaders() },
        );
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from("usuarios")
      .select("nombre,plan")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("No se pudo cargar el perfil EOS:", profileError);
    }

    const nombreServidor =
      textoSeguro(profile?.nombre, 120) ||
      textoSeguro(user.user_metadata?.nombre, 120) ||
      textoSeguro(user.user_metadata?.name, 120) ||
      textoSeguro(user.email?.split("@")[0], 120) ||
      "Usuario";
    const planServidor = textoSeguro(profile?.plan, 40).toLowerCase() || "free";

    const payload = {
      request_id: esUuid(body.request_id) ? body.request_id : crypto.randomUUID(),
      usuario_id: user.id,
      conversacion_id: conversacionId,
      nombre: nombreServidor,
      plan: planServidor,
      mensaje: textoSeguro(body.mensaje, 12_000),
      historial: Array.isArray(body.historial) ? body.historial.slice(-10) : [],
      origen: "eos-web",
      fecha: new Date().toISOString(),
    };

    if (!payload.mensaje) {
      return Response.json(
        {
          respuesta: "Necesito recibir un mensaje para poder ayudarte bien.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const quotaAdmin: any = createAdminClient();
    const { data: quotaRaw, error: quotaError } = await quotaAdmin.rpc(
      "eos_reserve_message_quota_server_v75",
      {
        p_usuario_id: user.id,
        p_request_id: payload.request_id,
      },
    );

    if (
      quotaError ||
      !quotaRaw ||
      typeof quotaRaw !== "object" ||
      Array.isArray(quotaRaw)
    ) {
      console.error(
        "No se pudo reservar la cuota de mensajes EOS:",
        quotaError || quotaRaw,
      );
      return Response.json(
        {
          respuesta:
            "No pudimos verificar tu disponibilidad de mensajes. Probá nuevamente en unos segundos.",
          code: "EOS_MESSAGE_QUOTA_UNAVAILABLE",
        },
        { status: 503, headers: noStoreHeaders() },
      );
    }

    const quota = quotaRaw as Record<string, unknown>;
    if (quota.allowed !== true) {
      const code =
        typeof quota.code === "string" ? quota.code : "EOS_MESSAGE_NOT_ALLOWED";
      const isLimit = code === "EOS_MESSAGE_LIMIT_REACHED";
      const isInProgress = code === "EOS_MESSAGE_REQUEST_IN_PROGRESS";
      const isConsumedReplay = code === "EOS_MESSAGE_REQUEST_ALREADY_CONSUMED";
      const isReplayConflict = isInProgress || isConsumedReplay;
      const isFree = quota.plan === "free";

      return Response.json(
        {
          respuesta: isLimit
            ? isFree
              ? "Llegaste a tus 5 mensajes gratuitos de hoy. Tu cupo se renueva mañana según la hora de Paraguay. Si querés seguir ahora, podés elegir un plan en Planes."
              : "Llegaste al límite de mensajes de tu plan actual. Podés revisar tus opciones en Planes."
            : isInProgress
              ? "Este mensaje ya se está procesando. Esperá la respuesta antes de volver a enviarlo."
              : isConsumedReplay
                ? "Este mensaje ya fue procesado. Para continuar, enviá un mensaje nuevo."
                : "Tu suscripción no permite enviar mensajes en este momento. Revisá tu plan para continuar.",
          code,
          commercial: quota,
          ...(isLimit || !isReplayConflict ? { upgrade_url: "/planes" } : {}),
        },
        {
          status: isReplayConflict ? 409 : isLimit ? 429 : 402,
          headers: noStoreHeaders(),
        },
      );
    }

    let quotaReleased = false;
    const releaseQuota = async (reason: string) => {
      if (quotaReleased) return;
      quotaReleased = true;

      const { error: releaseError } = await quotaAdmin.rpc(
        "eos_release_message_quota_server_v75",
        {
          p_usuario_id: user.id,
          p_request_id: payload.request_id,
          p_reason: reason.slice(0, 160),
        },
      );

      if (releaseError) {
        console.error("No se pudo liberar la reserva de mensaje EOS:", releaseError);
      }
    };

    releaseReservedQuota = releaseQuota;

    let response: Response;
    try {
      response = await fetch(
        "https://n8n-production-6cdb.up.railway.app/webhook/eos-chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (n8nError) {
      await releaseQuota(
        n8nError instanceof Error &&
          (n8nError.name === "TimeoutError" || n8nError.name === "AbortError")
          ? "n8n_timeout"
          : "n8n_fetch_error",
      );
      throw n8nError;
    }

    const rawText = await response.text();

    let respuesta = "";

    try {
      const data = JSON.parse(rawText);
      respuesta = buscarTexto(data);
    } catch {
      respuesta = rawText;
    }

    respuesta = limpiarRespuesta(respuesta);
    const respuestaValida = Boolean(respuesta && respuesta !== "[object Object]");

    if (!response.ok) {
      console.log("Error desde n8n:", response.status, rawText);
      await releaseQuota(`n8n_http_${response.status}`);

      return Response.json(
        {
          respuesta:
            "EOS recibió tu mensaje, pero tuvo un problema procesándolo. Probá nuevamente en unos segundos.",
        },
        { status: response.status, headers: noStoreHeaders() },
      );
    }

    if (!respuestaValida) {
      await releaseQuota("n8n_empty_response");
      return Response.json(
        {
          respuesta:
            "Recibí tu mensaje, pero EOS no pudo generar una respuesta clara en este momento. Probá nuevamente.",
          code: "EOS_EMPTY_RESPONSE",
        },
        { status: 502, headers: noStoreHeaders() },
      );
    }

    const { data: finalizeRaw, error: finalizeError } = await quotaAdmin.rpc(
      "eos_finalize_message_quota_server_v75",
      {
        p_usuario_id: user.id,
        p_request_id: payload.request_id,
      },
    );

    const finalizeOk =
      !finalizeError &&
      finalizeRaw &&
      typeof finalizeRaw === "object" &&
      !Array.isArray(finalizeRaw) &&
      (finalizeRaw as Record<string, unknown>).ok === true;

    if (!finalizeOk) {
      console.error(
        "EOS respondió, pero no se pudo confirmar el consumo:",
        finalizeError || finalizeRaw,
      );
      await releaseQuota("quota_finalize_failed");
      return Response.json(
        {
          respuesta:
            "EOS procesó tu mensaje, pero no pudimos confirmar tu cupo de forma segura. Probá nuevamente.",
          code: "EOS_MESSAGE_QUOTA_FINALIZE_FAILED",
        },
        { status: 503, headers: noStoreHeaders() },
      );
    }

    quotaReleased = true;
    releaseReservedQuota = null;

    try {
      await fetch(
        process.env.N8N_DECISION_CAPTURE_URL ||
          "https://n8n-production-6cdb.up.railway.app/webhook/eos-decision-capture",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usuario_id: payload.usuario_id,
            request_id: payload.request_id,
            conversacion_id: payload.conversacion_id,
            mensaje: payload.mensaje,
            respuesta,
          }),
          signal: AbortSignal.timeout(2500),
        },
      );
    } catch (captureError) {
      console.log("Registro de decisión no disponible:", captureError);
    }

    return Response.json(
      {
        respuesta,
        metadata: {
          usuario_id: payload.usuario_id,
          request_id: payload.request_id,
          conversacion_id: payload.conversacion_id,
          origen: payload.origen,
          fecha: payload.fecha,
        },
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (releaseReservedQuota) {
      try {
        await releaseReservedQuota("api_eos_exception");
      } catch (releaseError) {
        console.error("No se pudo liberar la reserva tras excepción:", releaseError);
      }
    }

    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");

    console.log("Error proxy EOS:", error);

    return Response.json(
      {
        respuesta: timeout
          ? "EOS tardó más de lo esperado en responder. Probá nuevamente en unos segundos."
          : "No pude conectarme con EOS en este momento. Probá nuevamente.",
      },
      { status: timeout ? 504 : 500, headers: noStoreHeaders() },
    );
  }
}
