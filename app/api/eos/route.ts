import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

const N8N_EOS_URL =
  process.env.N8N_EOS_WEBHOOK_URL ||
  "https://n8n-production-6cdb.up.railway.app/webhook/eos-chat";

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_HISTORY_ITEMS = 10;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_FILE_BASE64_LENGTH = 21 * 1024 * 1024;
const N8N_TIMEOUT_MS = 90_000;

const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

type HistorialItem = {
  rol?: unknown;
  texto?: unknown;
};

type UsuarioEOS = {
  nombre: string | null;
  plan: string | null;
  estado_suscripcion: string | null;
  plan_vencimiento: string | null;
};

type ArchivoEOS = {
  nombre: string;
  tipo: string;
  tamanio?: number;
  base64: string;
  extension?: string;
};

type RespuestaN8N = {
  respuesta: string;
  archivo_url: string;
  archivo_tipo: string;
  archivo_nombre: string;
  tipo: string;
  accion: string;
  metadata: Record<string, unknown>;
};

function buscarTexto(valor: unknown): string {
  if (!valor) return "";

  if (typeof valor === "string") return valor;

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = buscarTexto(item);
      if (encontrado) return encontrado;
    }
    return "";
  }

  if (typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;

    const camposPrioritarios = [
      "respuesta",
      "text",
      "message",
      "output",
      "content",
      "data",
      "body",
      "json",
    ];

    for (const campo of camposPrioritarios) {
      const encontrado = buscarTexto(objeto[campo]);
      if (encontrado) return encontrado;
    }

    for (const valorInterno of Object.values(objeto)) {
      const encontrado = buscarTexto(valorInterno);
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      valor,
    )
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

function normalizarHistorial(valor: unknown) {
  if (!Array.isArray(valor)) {
    return [];
  }

  return valor
    .slice(-MAX_HISTORY_ITEMS)
    .map((item): { rol: "usuario" | "eos"; texto: string } | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const registro = item as HistorialItem;

      const rol =
        registro.rol === "usuario" || registro.rol === "eos"
          ? registro.rol
          : null;

      const texto =
        typeof registro.texto === "string"
          ? registro.texto.trim().slice(0, MAX_MESSAGE_LENGTH)
          : "";

      if (!rol || !texto) {
        return null;
      }

      return { rol, texto };
    })
    .filter(
      (item): item is { rol: "usuario" | "eos"; texto: string } =>
        item !== null,
    );
}

function planEfectivo(usuario: UsuarioEOS | null): string {
  if (!usuario) return "free";

  const plan = usuario.plan?.trim().toLowerCase() || "free";

  const estado = usuario.estado_suscripcion?.trim().toLowerCase() || "active";

  if (estado !== "active" && estado !== "activo" && plan !== "free") {
    return "free";
  }

  if (
    usuario.plan_vencimiento &&
    new Date(usuario.plan_vencimiento).getTime() <= Date.now()
  ) {
    return "free";
  }

  return plan;
}

function tipoArchivoPermitido(tipo: string): boolean {
  return tipo.startsWith("image/") || ALLOWED_FILE_TYPES.has(tipo);
}

function obtenerExtension(nombre: string): string {
  const partes = nombre.split(".");
  return partes.length > 1 ? partes.pop()!.toLowerCase() : "";
}

function normalizarArchivo(valor: unknown): ArchivoEOS | null {
  if (!valor || typeof valor !== "object") {
    return null;
  }

  const registro = valor as Record<string, unknown>;

  const nombre =
    typeof registro.nombre === "string"
      ? registro.nombre.trim().slice(0, 255)
      : "";

  const tipo =
    typeof registro.tipo === "string"
      ? registro.tipo.trim().toLowerCase()
      : "";

  const base64 =
    typeof registro.base64 === "string" ? registro.base64.trim() : "";

  const tamanio =
    typeof registro.tamanio === "number" && Number.isFinite(registro.tamanio)
      ? Math.max(0, Math.trunc(registro.tamanio))
      : undefined;

  if (!nombre || !tipo || !base64) {
    throw new Error("El archivo adjunto está incompleto.");
  }

  if (!tipoArchivoPermitido(tipo)) {
    throw new Error("El formato del archivo no está permitido.");
  }

  if (tamanio !== undefined && tamanio > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      "El archivo supera el tamaño máximo permitido de 15 MB.",
    );
  }

  if (base64.length > MAX_FILE_BASE64_LENGTH) {
    throw new Error("El archivo supera el tamaño máximo permitido.");
  }

  return {
    nombre,
    tipo,
    tamanio,
    base64,
    extension:
      typeof registro.extension === "string"
        ? registro.extension.trim().toLowerCase().slice(0, 15)
        : obtenerExtension(nombre),
  };
}

function combinarObjetoRespuesta(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object") {
    return {};
  }

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = combinarObjetoRespuesta(item);
      if (Object.keys(encontrado).length > 0) {
        return encontrado;
      }
    }
    return {};
  }

  let data = valor as Record<string, unknown>;

  if (data.body && typeof data.body === "object" && !Array.isArray(data.body)) {
    data = { ...data, ...(data.body as Record<string, unknown>) };
  }

  if (
    data.response &&
    typeof data.response === "object" &&
    !Array.isArray(data.response)
  ) {
    const response = data.response as Record<string, unknown>;

    if (
      response.body &&
      typeof response.body === "object" &&
      !Array.isArray(response.body)
    ) {
      data = { ...data, ...(response.body as Record<string, unknown>) };
    }
  }

  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    data = { ...data, ...(data.data as Record<string, unknown>) };
  }

  return data;
}

function normalizarRespuestaN8N(rawText: string): RespuestaN8N {
  let parsed: unknown = rawText;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = rawText;
  }

  const data = combinarObjetoRespuesta(parsed);

  const textoOriginal =
    data.respuesta ?? data.output ?? data.text ?? data.message ?? buscarTexto(parsed);

  const texto =
    typeof textoOriginal === "string" ? textoOriginal : String(textoOriginal || "");

  const urlEncontrada = texto.match(/https?:\/\/[^\s]+/)?.[0] || "";

  const archivoUrl = String(
    data.archivo_url ?? data.archivoUrl ?? data.download_url ?? data.url ?? urlEncontrada,
  ).trim();

  const respuesta = limpiarRespuesta(
    texto.replace(/Descargar archivo:\s*https?:\/\/[^\s]+/i, "").trim() ||
      (archivoUrl ? "Tu archivo ya está listo para descargar." : "Listo."),
  );

  return {
    respuesta:
      respuesta && respuesta !== "[object Object]"
        ? respuesta
        : "Recibí tu mensaje, pero EOS no pudo generar una respuesta clara en este momento. Probá nuevamente.",
    archivo_url: archivoUrl,
    archivo_tipo: archivoUrl ? String(data.archivo_tipo ?? data.archivoTipo ?? "archivo") : "",
    archivo_nombre: String(data.archivo_nombre ?? data.archivoNombre ?? ""),
    tipo: archivoUrl ? "archivo" : String(data.tipo ?? "texto"),
    accion: archivoUrl
      ? String(data.accion ?? "GENERAR_ARCHIVO")
      : String(data.accion ?? "RESPONDER"),
    metadata:
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {},
  };
}

export async function POST(req: Request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  let releaseReservedQuota: ((reason: string) => Promise<void>) | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { respuesta: "Tu sesión no es válida o venció. Iniciá sesión nuevamente." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { respuesta: "La solicitud enviada no es válida." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    let archivo: ArchivoEOS | null;
    try {
      archivo = normalizarArchivo(body.archivo);
    } catch (error) {
      return Response.json(
        {
          respuesta:
            error instanceof Error ? error.message : "El archivo adjunto no es válido.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const mensaje = typeof body.mensaje === "string" ? body.mensaje.trim() : "";

    if (!mensaje && !archivo) {
      return Response.json(
        { respuesta: "Necesito recibir un mensaje o un archivo para poder ayudarte." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (mensaje.length > MAX_MESSAGE_LENGTH) {
      return Response.json(
        { respuesta: "El mensaje es demasiado extenso. Reducilo e intentá nuevamente." },
        { status: 413, headers: noStoreHeaders() },
      );
    }

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

    const { data: usuario, error: usuarioError } = await supabase
      .from("usuarios")
      .select("nombre, plan, estado_suscripcion, plan_vencimiento")
      .eq("id", user.id)
      .maybeSingle<UsuarioEOS>();

    if (usuarioError) {
      console.error("No se pudo cargar el perfil EOS:", usuarioError);
    }

    const nombreServidor =
      textoSeguro(usuario?.nombre, 120) ||
      textoSeguro(user.user_metadata?.nombre, 120) ||
      textoSeguro(user.user_metadata?.name, 120) ||
      textoSeguro(user.email?.split("@")[0], 120) ||
      "Usuario";
    const planServidor = planEfectivo(usuario ?? null);

    const origen = textoSeguro(body.origen, 50) || "eos-web";
    const nuevoChat = body.nuevo_chat === true;
    const requestId = esUuid(body.request_id) ? body.request_id : crypto.randomUUID();

    const payload = {
      request_id: requestId,
      usuario_id: user.id,
      conversacion_id: conversacionId,
      nombre: nombreServidor,
      plan: planServidor,
      mensaje,
      historial: normalizarHistorial(body.historial),
      nuevo_chat: nuevoChat,
      archivo,
      origen,
      fecha: new Date().toISOString(),
    };

    const quotaAdmin: any = createAdminClient();
    const { data: quotaRaw, error: quotaError } = await quotaAdmin.rpc(
      "eos_reserve_message_quota_server_v75",
      {
        p_usuario_id: user.id,
        p_request_id: payload.request_id,
      },
    );

    if (quotaError || !quotaRaw || typeof quotaRaw !== "object" || Array.isArray(quotaRaw)) {
      console.error("No se pudo reservar la cuota de mensajes EOS:", quotaError || quotaRaw);
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
      const code = typeof quota.code === "string" ? quota.code : "EOS_MESSAGE_NOT_ALLOWED";
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

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.N8N_EOS_INTERNAL_SECRET) {
      headers["x-eos-internal-secret"] = process.env.N8N_EOS_INTERNAL_SECRET;
    }

    let response: Response;
    try {
      response = await fetch(N8N_EOS_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (n8nError) {
      await releaseQuota(
        n8nError instanceof Error && n8nError.name === "AbortError"
          ? "n8n_timeout"
          : "n8n_fetch_error",
      );
      throw n8nError;
    }

    const rawText = await response.text();

    if (!response.ok) {
      console.error("Error desde n8n:", response.status, rawText.slice(0, 1_000));
      await releaseQuota(`n8n_http_${response.status}`);

      return Response.json(
        {
          respuesta:
            "EOS recibió tu mensaje, pero tuvo un problema procesándolo. Probá nuevamente en unos segundos.",
        },
        {
          status: response.status >= 400 && response.status < 600 ? response.status : 502,
          headers: noStoreHeaders(),
        },
      );
    }

    if (!rawText.trim()) {
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

    const resultado = normalizarRespuestaN8N(rawText);

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
            respuesta: resultado.respuesta,
          }),
          signal: AbortSignal.timeout(2500),
        },
      );
    } catch (captureError) {
      console.log("Registro de decisión no disponible:", captureError);
    }

    return Response.json(
      {
        ...resultado,
        metadata: {
          ...resultado.metadata,
          usuario_id: payload.usuario_id,
          request_id: payload.request_id,
          conversacion_id: payload.conversacion_id,
          origen: payload.origen,
          fecha: payload.fecha,
          archivo_recibido: Boolean(archivo),
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

    const timeout = error instanceof Error && error.name === "AbortError";

    console.log("Error proxy EOS:", error);

    return Response.json(
      {
        respuesta: timeout
          ? "EOS tardó más de lo esperado en responder. Probá nuevamente en unos segundos."
          : "No pude conectarme con EOS en este momento. Probá nuevamente.",
      },
      { status: timeout ? 504 : 500, headers: noStoreHeaders() },
    );
  } finally {
    clearTimeout(timeout);
  }
}
