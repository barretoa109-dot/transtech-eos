import type { ImagenAdjunta, Mensaje } from "../types/chat";

type EnviarEOSParams = {
  usuarioId: string;
  conversacionId: string;
  nombre: string;
  plan: string;
  mensaje: string;
  historial: Mensaje[];
  nuevoChat: boolean;
  imagen?: ImagenAdjunta | null;
};

export type RespuestaEOS = {
  respuesta: string;
  tipo: string;
  accion: string;
  archivo_url: string;
  archivo_tipo: string;
  metadata: Record<string, unknown>;
};

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
  data?.respuesta ||
    data?.output ||
    data?.text ||
    data?.message ||
    ""
);

const urlEncontrada =
  textoRespuestaOriginal.match(/https?:\/\/[^\s]+/)?.[0] || "";

const archivoUrl = String(
  data?.archivo_url ||
    data?.archivoUrl ||
    data?.download_url ||
    data?.url ||
    urlEncontrada ||
    ""
).trim();

  const respuesta = limpiarTexto(
  textoRespuestaOriginal
    .replace(/Descargar archivo:\s*https?:\/\/[^\s]+/i, "")
    .trim() ||
    (archivoUrl
      ? "Tu archivo ya está listo para descargar."
      : "Listo.")
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
    metadata:
      data?.metadata && typeof data.metadata === "object"
        ? data.metadata
        : {},
  };
}

export async function enviarMensajeAEOS(
  params: EnviarEOSParams
): Promise<RespuestaEOS> {
  const response = await fetch("/api/eos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      usuario_id: params.usuarioId,
      conversacion_id: params.conversacionId,
      nombre: params.nombre,
      plan: params.plan,
      mensaje: params.mensaje,
      historial: params.historial
        .filter((m) => !m.texto.includes("Este es un nuevo chat"))
        .slice(-10),
      nuevo_chat: params.nuevoChat,
      imagen: params.imagen || null,
      origen: "eos-web",
    }),
  });

  const raw = await response.text();

  if (!raw.trim()) {
    throw new Error("EOS respondió vacío");
  }

  let contenido: unknown = raw;

  try {
    contenido = JSON.parse(raw);
  } catch {
    contenido = raw;
  }

  const resultado = normalizarRespuesta(contenido);

  if (!response.ok) {
    throw new Error(resultado.respuesta || "Error en EOS");
  }

  return resultado;
}