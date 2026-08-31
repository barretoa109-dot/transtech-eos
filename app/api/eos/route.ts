import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import type { Documento } from "@/lib/documentos/especificacion";
import {
  extraerDocumento,
  formatoPedido,
  guardarDocumento,
  FORMATOS as FORMATOS_DOCUMENTO,
} from "@/lib/documentos/guardar";
import { textoContexto, type ContextoNegocio } from "@/lib/eos/contexto-negocio";
import { POST as ingestDocument } from "@/app/api/documents/ingest/route";
import { POST as analyzeDocument } from "@/app/api/documents/[id]/analyze/route";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

const SYNC_EXTRACTABLE_TYPES = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // PDF con capa de texto: extraído con unpdf en /api/documents/ingest.
  // Los escaneados quedan marcados como pendientes de OCR y no rompen nada.
  "application/pdf",
]);

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
  /* Lo que consumió el mensaje en OpenAI. Cero si el gateway no lo mandó. */
  tokens_entrada: number;
  tokens_salida: number;
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

/**
 * Igual que `normalizarRespuestaN8N`, pero además saca del texto la
 * descripción del documento que EOS haya querido armar.
 *
 * Va separado de la normalización porque guardar el documento necesita el
 * usuario y la conversación, y la normalización es pura. Ver
 * `lib/documentos/guardar.ts` para las dos formas en que puede llegar.
 */
function normalizarRespuestaConDocumento(rawText: string): RespuestaN8N & {
  documento: Documento | null;
  recortes: string[];
} {
  const base = normalizarRespuestaN8N(rawText);

  let datos: Record<string, unknown> = {};
  try {
    datos = combinarObjetoRespuesta(JSON.parse(rawText));
  } catch {
    datos = {};
  }

  const extraido = extraerDocumento(base.respuesta, datos);

  if (extraido.motivo) {
    console.error("Documentos: EOS mandó un documento que no se pudo leer:", extraido.motivo);
  }

  return {
    ...base,
    // El texto sin el bloque cercado: el JSON crudo no puede quedar en la
    // burbuja del chat.
    respuesta: extraido.texto || base.respuesta,
    documento: extraido.documento,
    recortes: extraido.recortes,
  };
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

    /* Si el gateway todavía no los manda, quedan en cero y no rompen nada. */
    tokens_entrada: Number(data.tokens_entrada ?? 0) || 0,
    tokens_salida: Number(data.tokens_salida ?? 0) || 0,
  };
}

async function analizarArchivoSincrono(
  archivo: ArchivoEOS,
  conversacionId: string,
): Promise<string | null> {
  try {
    const bytes = Buffer.from(archivo.base64, "base64");
    const file = new File([bytes], archivo.nombre, { type: archivo.tipo });

    const formData = new FormData();
    formData.append("archivo", file);
    if (conversacionId) formData.append("conversacion_id", conversacionId);

    const ingestRequest = new Request("http://eos.internal/api/documents/ingest", {
      method: "POST",
      body: formData,
    });

    const ingestResponse = await ingestDocument(ingestRequest);
    if (!ingestResponse.ok) return null;

    const ingestData = (await ingestResponse.json()) as {
      document?: { id?: string; extraction_status?: string };
      extraction?: { status?: string };
    };

    const documentId = ingestData.document?.id;
    const extractionStatus =
      ingestData.extraction?.status || ingestData.document?.extraction_status || "";
    if (!documentId || !["ready", "partial"].includes(extractionStatus)) {
      return null;
    }

    const analyzeRequest = new Request(
      `http://eos.internal/api/documents/${documentId}/analyze`,
      { method: "POST" },
    );

    const analyzeResponse = await analyzeDocument(analyzeRequest, {
      params: Promise.resolve({ id: documentId }),
    });
    if (!analyzeResponse.ok) return null;

    const analysis = (await analyzeResponse.json()) as {
      summary?: string;
      top_findings?: Array<{ title?: string; value_text?: string | null }>;
    };

    const hallazgos = (analysis.top_findings || [])
      .slice(0, 6)
      .map((f) => `- ${f.title}${f.value_text ? `: ${f.value_text}` : ""}`)
      .join("\n");

    const partes = [
      `[Documento adjunto: ${archivo.nombre}]`,
      analysis.summary ? `Resumen: ${analysis.summary}` : "",
      hallazgos ? `Hallazgos:\n${hallazgos}` : "",
    ].filter(Boolean);

    return partes.length > 1 ? partes.join("\n") : null;
  } catch (error) {
    console.error("No se pudo analizar el documento adjunto de forma sincrónica:", error);
    return null;
  }
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

    // El perfil no depende de la verificación de la conversación ni del
    // análisis del adjunto, así que se dispara ya y se espera recién cuando
    // hace falta: era un viaje a Supabase esperando en fila sin motivo.
    // Nunca rechaza, para que un `return` temprano no deje una promesa suelta.
    const usuarioPromise: Promise<{ data: UsuarioEOS | null; error: unknown }> = Promise.resolve(
      supabase
        .from("usuarios")
        .select("nombre, plan, estado_suscripcion, plan_vencimiento")
        .eq("id", user.id)
        .maybeSingle<UsuarioEOS>(),
    ).catch((error: unknown) => ({ data: null, error }));

    /*
     * Cómo va el negocio, pedido en paralelo con el perfil.
     *
     * Va en el prompt de CADA mensaje: sin esto el asistente no sabe una sola
     * cifra del negocio de quien le escribe, y "¿cómo venimos este mes?" sólo
     * se puede contestar con generalidades.
     *
     * Es una función sola —29 ms medidos contra producción— y no ocho consultas
     * sueltas, porque esto está en el camino crítico de una conversación. Si
     * falla, se sigue sin contexto: quedarse sin contestar por no poder contar
     * las ventas sería peor que contestar sin las ventas.
     */
    const contextoPromise: Promise<ContextoNegocio | null> = Promise.resolve(
      adminSinTipos().rpc("eos_contexto_negocio", { p_usuario_id: user.id }),
    )
      .then(({ data, error }: { data: ContextoNegocio | null; error: unknown }) => {
        if (error) {
          console.error("EOS: no se pudo armar el contexto del negocio:", error);
          return null;
        }

        return data;
      })
      .catch((error: unknown) => {
        console.error("EOS: error inesperado armando el contexto:", error);
        return null;
      });

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

    let mensajeConAnalisis = mensaje;
    if (archivo && SYNC_EXTRACTABLE_TYPES.has(archivo.tipo)) {
      const analisis = await analizarArchivoSincrono(archivo, conversacionId);
      if (analisis) {
        mensajeConAnalisis = mensaje ? `${mensaje}\n\n${analisis}` : analisis;
      }
    }

    const { data: usuario, error: usuarioError } = await usuarioPromise;

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

    const contextoNegocio = textoContexto(await contextoPromise);

    const origen = textoSeguro(body.origen, 50) || "eos-web";
    const nuevoChat = body.nuevo_chat === true;
    const requestId = esUuid(body.request_id) ? body.request_id : crypto.randomUUID();

    const payload = {
      request_id: requestId,
      usuario_id: user.id,
      conversacion_id: conversacionId,
      nombre: nombreServidor,
      plan: planServidor,
      // Vacío cuando la persona todavía no cargó nada: mandar un bloque lleno
      // de ceros haría que el modelo hable de un negocio parado.
      contexto_negocio: contextoNegocio,
      mensaje: mensajeConAnalisis,
      historial: normalizarHistorial(body.historial),
      nuevo_chat: nuevoChat,
      archivo,
      origen,
      fecha: new Date().toISOString(),
    };

    const quotaAdmin = adminSinTipos();
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

    const resultado = normalizarRespuestaConDocumento(rawText);

    /*
     * ============================================================
     * CUÁNTO COSTÓ ESTE MENSAJE
     * ============================================================
     *
     * Los tokens vienen del gateway, que los saca de la respuesta de OpenAI.
     * Antes se descartaban y `uso_mensual` acumulaba ceros: EOS cobraba por mes
     * sin saber cuánto le costaba cada usuario.
     *
     * Importa más de lo que parece porque el consumo NO es proporcional a los
     * mensajes. Un "hola" ya cuesta unos 1.300 tokens de entrada —el prompt
     * lleva el contexto del negocio, el historial y las instrucciones— y un
     * mensaje con una foto adjunta cuesta un orden de magnitud más. Dos
     * clientes con el mismo plan y la misma cantidad de mensajes pueden
     * costarnos diez veces distinto.
     *
     * El precio en dólares sale de dos variables de entorno y NO de una
     * constante en el código: la tarifa cambia con cada modelo, y un número
     * clavado acá es un número que dentro de tres meses es falso y nadie
     * corrige. Si no están configuradas, el costo queda en cero y los tokens
     * igual se guardan — que es lo que después se puede convertir a plata en
     * cualquier momento.
     */
    const tokensEntrada = Math.max(0, Math.trunc(Number(resultado.tokens_entrada ?? 0)) || 0);
    const tokensSalida = Math.max(0, Math.trunc(Number(resultado.tokens_salida ?? 0)) || 0);

    const costoEstimado =
      (tokensEntrada / 1_000_000) * Number(process.env.EOS_USD_POR_MTOK_ENTRADA || 0) +
      (tokensSalida / 1_000_000) * Number(process.env.EOS_USD_POR_MTOK_SALIDA || 0);

    const { data: finalizeRaw, error: finalizeError } = await quotaAdmin.rpc(
      "eos_finalize_message_quota_server_v75",
      {
        p_usuario_id: user.id,
        p_request_id: payload.request_id,
        p_tokens_entrada: tokensEntrada,
        p_tokens_salida: tokensSalida,
        p_costo_estimado_usd: Number.isFinite(costoEstimado) ? costoEstimado : 0,
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

    /*
     * El archivo que EOS quiso mandar.
     *
     * Se guarda DESPUÉS de confirmar el cupo y no antes: si el mensaje se cae a
     * mitad de camino, no queda un documento colgado que el usuario nunca pidió.
     * Y si el guardado falla, la respuesta sale igual sin el enlace — perder el
     * archivo es molesto, perder la respuesta entera por el archivo es peor.
     */
    let archivoDocumento: { url: string; nombre: string; tipo: string } | null = null;

    if (resultado.documento) {
      const formato = formatoPedido(payload.mensaje, resultado.metadata?.formato);

      const guardado = await guardarDocumento(createAdminClient(), {
        usuarioId: user.id,
        conversacionId: payload.conversacion_id,
        documento: resultado.documento,
        formato,
        recortes: resultado.recortes,
      });

      if (guardado) {
        archivoDocumento = {
          url: guardado.url,
          nombre: guardado.nombreArchivo,
          tipo: FORMATOS_DOCUMENTO[formato].etiqueta.toLowerCase(),
        };
      }
    }

    after(async () => {
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
    });

    // La descripción del documento no viaja al cliente: ya está guardada, y
    // puede pesar más que la respuesta entera. Por eso se nombran los campos
    // uno por uno en vez de esparcir `resultado`.
    const paraElCliente = {
      respuesta: resultado.respuesta,
      archivo_url: resultado.archivo_url,
      archivo_tipo: resultado.archivo_tipo,
      archivo_nombre: resultado.archivo_nombre,
      tipo: resultado.tipo,
      accion: resultado.accion,
    };

    return Response.json(
      {
        ...paraElCliente,
        ...(archivoDocumento
          ? {
              archivo_url: archivoDocumento.url,
              archivo_nombre: archivoDocumento.nombre,
              archivo_tipo: archivoDocumento.tipo,
              tipo: "archivo",
              accion: "GENERAR_ARCHIVO",
            }
          : {}),
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

    console.error("Error proxy EOS:", error);

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
