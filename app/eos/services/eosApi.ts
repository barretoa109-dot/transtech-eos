import type { ImagenAdjunta, Mensaje } from "../types/chat";

type EnviarEOSParams = {
  requestId: string;
  conversacionId: string;
  mensaje: string;
  historial: Mensaje[];
  nuevoChat: boolean;
  imagen?: ImagenAdjunta | null;
  documentoId?: string | null;
};

export type RespuestaEOS = {
  respuesta?: string;
  archivo_url?: string;
  archivo_tipo?: string;
  archivo_nombre?: string;
  tipo?: string;
  accion?: string;
  metadata?: Record<string, unknown>;
};

export class EOSApiError extends Error {
  code: string;
  status: number;
  upgradeUrl: string | null;
  commercial: Record<string, unknown> | null;

  constructor(
    message: string,
    options: {
      code?: string;
      status: number;
      upgradeUrl?: string | null;
      commercial?: Record<string, unknown> | null;
    },
  ) {
    super(message);
    this.name = "EOSApiError";
    this.code = options.code || "EOS_API_ERROR";
    this.status = options.status;
    this.upgradeUrl = options.upgradeUrl || null;
    this.commercial = options.commercial || null;
  }
}

function limpiarTexto(valor: unknown): string {
  if (typeof valor !== "string") return "";

  return valor
    .replace(/^=/, "")
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

function normalizarRespuesta(valor: unknown): RespuestaEOS {
  let data: any = valor;

  if (typeof data === "string") {
    const texto = data.trim();

    try {
      data = JSON.parse(texto);
    } catch {
      return {
        respuesta: limpiarTexto(texto),
        tipo: "texto",
        accion: "RESPONDER",
        archivo_url: "",
        archivo_tipo: "",
        archivo_nombre: "",
        metadata: {},
      };
    }
  }

  if (data?.body && typeof data.body === "object") {
    data = data.body;
  }

  if (data?.response?.body && typeof data.response.body === "object") {
    data = data.response.body;
  }

  if (typeof data?.data === "object" && data.data !== null) {
    data = {
      ...data,
      ...data.data,
    };
  }

  const textoRespuestaOriginal = String(
    data?.respuesta || data?.output || data?.text || data?.message || "",
  );

  const urlEncontrada =
    textoRespuestaOriginal.match(/https?:\/\/[^\s]+/)?.[0] || "";

  const archivoUrl = String(
    data?.archivo_url ||
      data?.archivoUrl ||
      data?.download_url ||
      data?.url ||
      urlEncontrada ||
      "",
  ).trim();

  const archivoNombre = archivoUrl
    ? String(
        data?.archivo_nombre ||
          data?.archivoNombre ||
          data?.filename ||
          data?.file_name ||
          "",
      ).trim()
    : "";

  const respuesta = limpiarTexto(
    textoRespuestaOriginal
      .replace(/Descargar archivo:\s*https?:\/\/[^\s]+/i, "")
      .trim() ||
      (archivoUrl ? "Tu archivo ya está listo para descargar." : "Listo."),
  );

  return {
    respuesta,
    tipo: archivoUrl ? "archivo" : String(data?.tipo || "texto"),
    accion: archivoUrl
      ? String(data?.accion || "GENERAR_ARCHIVO")
      : String(data?.accion || "RESPONDER"),
    archivo_url: archivoUrl,
    archivo_tipo: archivoUrl
      ? String(data?.archivo_tipo || data?.archivoTipo || "excel")
      : "",
    archivo_nombre: archivoNombre,
    metadata:
      data?.metadata && typeof data.metadata === "object"
        ? data.metadata
        : {},
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function enviarMensajeAEOS(
  params: EnviarEOSParams,
): Promise<RespuestaEOS> {
  const response = await fetch("/api/eos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: params.requestId,
      conversacion_id: params.conversacionId,
      mensaje: params.mensaje,
      historial: params.historial
        .filter((m) => !m.texto.includes("Este es un nuevo chat"))
        .slice(-10),
      nuevo_chat: params.nuevoChat,
      imagen: params.imagen || null,
      documento_id: params.documentoId || null,
      origen: "eos-web",
    }),
  });

  const raw = await response.text();

  if (!raw.trim()) {
    throw new EOSApiError("EOS respondió vacío", {
      status: response.status || 502,
      code: "EOS_EMPTY_HTTP_RESPONSE",
    });
  }

  let contenido: unknown = raw;

  try {
    contenido = JSON.parse(raw);
  } catch {
    contenido = raw;
  }

  const resultado = normalizarRespuesta(contenido);

  if (!response.ok) {
    const payload = objectValue(contenido);
    throw new EOSApiError(resultado.respuesta || "Error en EOS", {
      status: response.status,
      code: typeof payload?.code === "string" ? payload.code : "EOS_API_ERROR",
      upgradeUrl:
        typeof payload?.upgrade_url === "string" ? payload.upgrade_url : null,
      commercial: objectValue(payload?.commercial),
    });
  }

  return resultado;
}
