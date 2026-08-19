import { supabase } from "../../../lib/supabase";
import type { Conversacion, Mensaje } from "../types/chat";

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
    .select("*")
    .eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error cargando mensajes de la conversación", conversacionId, ":", error);
    return [];
  }

  return (data || []).map((m: Record<string, unknown>) => ({
    id: typeof m.id === "string" ? m.id : undefined,
    rol: m.rol === "usuario" ? "usuario" : "eos",
    texto: (m.texto as string) || "",
  }));
}

/**
 * The `mensajes` table's RLS policies (select/insert/delete) all require
 * `usuario_id = auth.uid()`, and the column has no default or trigger — so an
 * insert without it is rejected, and any row already stored with a NULL
 * usuario_id is invisible to the owner. It must always be written explicitly.
 */
export async function guardarMensaje(
  conversacionId: string,
  usuarioId: string,
  rol: "usuario" | "eos",
  texto: string
) {
  if (!conversacionId || !usuarioId || !texto.trim()) return;

  const { error } = await supabase.from("mensajes").insert([
    {
      conversacion_id: conversacionId,
      usuario_id: usuarioId,
      rol,
      texto,
    },
  ]);

  if (error) {
    console.error("No se pudo guardar el mensaje:", error);
  }
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