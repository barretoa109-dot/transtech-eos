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

function extraerTextoEOS(valor: any): string {
  if (!valor) return "";
  if (typeof valor === "string") return valor;

  if (Array.isArray(valor)) {
    return valor.map(extraerTextoEOS).filter(Boolean).join("\n\n");
  }

  if (typeof valor === "object") {
    return (
      extraerTextoEOS(valor.respuesta) ||
      extraerTextoEOS(valor.output) ||
      extraerTextoEOS(valor.text) ||
      extraerTextoEOS(valor.message) ||
      extraerTextoEOS(valor.content) ||
      extraerTextoEOS(valor.data) ||
      extraerTextoEOS(valor.json) ||
      extraerTextoEOS(valor.choices?.[0]?.message?.content) ||
      extraerTextoEOS(valor.response?.body?.respuesta) ||
      ""
    );
  }

  return String(valor);
}

function limpiarRespuesta(valor: any): string {
  let texto = extraerTextoEOS(valor);

  if (!texto || texto === "[object Object]") return "";

  try {
    const parsed = JSON.parse(texto);
    const extraido = extraerTextoEOS(parsed);
    if (extraido) texto = extraido;
  } catch {}

  return texto
    .replace(/^=/, "")
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

export async function enviarMensajeAEOS(params: EnviarEOSParams) {
  const response = await fetch("/api/eos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  if (!raw || raw.trim() === "") {
    throw new Error("EOS respondió vacío");
  }

  const respuesta = (() => {
    try {
      return limpiarRespuesta(JSON.parse(raw));
    } catch {
      return limpiarRespuesta(raw);
    }
  })();

  if (!response.ok) {
    throw new Error(respuesta || "Error en EOS");
  }

  return respuesta;
}