import { supabase } from "../../../lib/supabase";
import type { Conversacion, Mensaje, RolMensaje } from "../types/chat";

export async function obtenerConversaciones(usuarioId: string): Promise<Conversacion[]> {
  const { data, error } = await supabase
    .from("conversaciones")
    .select("*")
    .eq("usuario_id", usuarioId)
    .order("created_at", { ascending: false });

  if (error) {
    console.log("Error cargando conversaciones:", error);
    return [];
  }

  return data || [];
}

export async function crearConversacion(usuarioId: string): Promise<Conversacion | null> {
  const { data, error } = await supabase
    .from("conversaciones")
    .insert([{ usuario_id: usuarioId, titulo: "Nuevo chat" }])
    .select()
    .single();

  if (error || !data) {
    console.log("Error creando conversación:", error);
    return null;
  }

  return data;
}

export async function obtenerMensajes(conversacionId: string): Promise<Mensaje[]> {
  const { data, error } = await supabase
    .from("mensajes")
    .select("id,rol,texto,created_at,request_id,metadata")
    .eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.log("Error cargando mensajes:", error);
    return [];
  }

  return (data || []).flatMap((item: any) => {
    const rol = item.rol === "usuario" ? "usuario" : item.rol === "eos" ? "eos" : null;
    const texto = typeof item.texto === "string" ? item.texto : "";

    if (!rol || !texto) return [];

    const metadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : {};

    return [{
      id: item.id,
      rol,
      texto,
      request_id: item.request_id || null,
      creado_en: item.created_at || undefined,
      metadata,
      archivo_url: stringMetadata(metadata, "archivo_url"),
      archivo_tipo: stringMetadata(metadata, "archivo_tipo"),
      archivo_nombre: stringMetadata(metadata, "archivo_nombre"),
      tipo: stringMetadata(metadata, "tipo") || "texto",
      accion: stringMetadata(metadata, "accion") || "RESPONDER",
    } satisfies Mensaje];
  });
}

type GuardarMensajeParams = {
  conversacionId: string;
  requestId: string;
  rol: RolMensaje;
  texto: string;
  reemplazarAnterior?: boolean;
  metadata?: Record<string, unknown>;
};

export async function guardarMensaje({
  conversacionId,
  requestId,
  rol,
  texto,
  reemplazarAnterior = false,
  metadata = {},
}: GuardarMensajeParams) {
  if (!conversacionId || !requestId || !texto.trim()) {
    throw new Error("El turno de chat no tiene los datos requeridos.");
  }

  const response = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversacion_id: conversacionId,
      request_id: requestId,
      rol,
      texto,
      reemplazar_anterior: reemplazarAnterior,
      metadata,
    }),
  });

  if (response.ok) return;

  const payload = await response.json().catch(() => null);
  throw new Error(
    typeof payload?.error === "string"
      ? payload.error
      : "No se pudo guardar el mensaje.",
  );
}

export async function actualizarTituloConversacion(
  conversacionId: string,
  textoUsuario: string
) {
  const texto = textoUsuario.toLowerCase();
  let titulo = "Nueva conversación EOS";

  if (texto.includes("excel") || texto.includes("planilla") || texto.includes("archivo")) {
    titulo = "Documento profesional";
  } else if (
    texto.includes("finanza") ||
    texto.includes("gasto") ||
    texto.includes("deuda") ||
    texto.includes("ahorro")
  ) {
    titulo = "Plan financiero";
  } else if (
    texto.includes("negocio") ||
    texto.includes("venta") ||
    texto.includes("empresa") ||
    texto.includes("cliente")
  ) {
    titulo = "Estrategia de negocio";
  } else if (
    texto.includes("objetivo") ||
    texto.includes("tarea") ||
    texto.includes("organizar")
  ) {
    titulo = "Objetivos y organización";
  } else if (texto.includes("hola") || texto.includes("buenas")) {
    titulo = "Inicio con EOS";
  } else {
    const palabras = textoUsuario
      .replace(/[¿?¡!.,]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);

    titulo = palabras.slice(0, 6).join(" ");
    if (titulo.length < 8) titulo = "Conversación EOS";
    if (titulo.length > 48) titulo = titulo.slice(0, 48) + "...";
  }

  await supabase.from("conversaciones").update({ titulo }).eq("id", conversacionId);

  return titulo;
}

function stringMetadata(metadata: Record<string, unknown>, key: string) {
  return typeof metadata[key] === "string" ? (metadata[key] as string) : "";
}
