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
  respuesta?: string;
  archivo_url?: string;
  archivo_tipo?: string;
  archivo_nombre?: string;
  tipo?: string;
  accion?: string;
  metadata?: Record<string, unknown>;
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

function comoRegistro(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;

  return valor as Record<string, unknown>;
}

function primerValor(
  registro: Record<string, unknown>,
  claves: string[],
): unknown {
  for (const clave of claves) {
    const valor = registro[clave];
    if (valor !== undefined && valor !== null && valor !== "") return valor;
  }

  return "";
}

function normalizarRespuesta(valor: unknown): RespuestaEOS {
  let data: unknown = valor;

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

  let registro = comoRegistro(data) ?? {};
  const body = comoRegistro(registro.body);

  if (body) {
    registro = body;
  }

  const response = comoRegistro(registro.response);
  const responseBody = comoRegistro(response?.body);

  if (responseBody) {
    registro = responseBody;
  }

  const nestedData = comoRegistro(registro.data);

  if (nestedData) {
    registro = {
      ...registro,
      ...nestedData,
    };
  }

  const textoRespuestaOriginal = String(
    primerValor(registro, ["respuesta", "output", "text", "message"]),
  );

  const urlEncontrada =
    textoRespuestaOriginal.match(/https?:\/\/[^\s]+/)?.[0] || "";

  const archivoUrl = String(
    primerValor(registro, [
      "archivo_url",
      "archivoUrl",
      "download_url",
      "url",
    ]) || urlEncontrada,
  ).trim();

  const respuesta = limpiarTexto(
    textoRespuestaOriginal
      .replace(/Descargar archivo:\s*https?:\/\/[^\s]+/i, "")
      .trim() ||
      (archivoUrl
        ? "Tu archivo ya está listo para descargar."
        : "Listo."),
  );

  return {
    respuesta,
    tipo: archivoUrl ? "archivo" : String(registro.tipo || "texto"),
    accion: archivoUrl
      ? String(registro.accion || "GENERAR_ARCHIVO")
      : String(registro.accion || "RESPONDER"),
    archivo_url: archivoUrl,
    archivo_tipo: archivoUrl
      ? String(primerValor(registro, ["archivo_tipo", "archivoTipo"]) || "excel")
      : "",
    metadata:
      comoRegistro(registro.metadata) ?? {},
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
