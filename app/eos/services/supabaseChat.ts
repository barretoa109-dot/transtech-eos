import { supabase } from "../../../lib/supabase";
import { fotosDeMetadata, type FotoGuardada } from "@/lib/eos/fotos-chat";
import { MINIMO_PARA_BUSCAR, fragmento, patronIlike } from "@/lib/eos/buscar-chats";
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

  const mensajes: Mensaje[] = (data || []).map((m: Record<string, unknown>) => {
    const fotos = m.rol === "usuario" ? fotosDeMetadata(m.metadata) : [];

    return {
      id: typeof m.id === "string" ? m.id : undefined,
      rol: m.rol === "usuario" ? "usuario" : "eos",
      texto: (m.texto as string) || "",
      ...(fotos.length > 0
        ? {
            imagenes: fotos.map((f) => ({
              nombre: f.nombre,
              ruta: f.ruta,
              ...(f.duracion ? { duracion: f.duracion } : {}),
            })),
          }
        : {}),
    };
  });

  return conEnlacesDeFotos(mensajes);
}

/*
 * Las fotos guardadas se ven con un enlace firmado de una hora.
 *
 * Un solo pedido para toda la conversación. Si falla, los mensajes vuelven
 * igual, sin miniaturas: la burbuja muestra la línea "[Imagen adjunta: …]"
 * de siempre, que es mejor que no mostrar la conversación.
 */
async function conEnlacesDeFotos(mensajes: Mensaje[]): Promise<Mensaje[]> {
  const rutas = mensajes.flatMap((m) =>
    (m.imagenes ?? []).map((i) => i.ruta).filter((r): r is string => Boolean(r)),
  );

  if (rutas.length === 0) return mensajes;

  let urls: Record<string, string> = {};

  try {
    const respuesta = await fetch("/api/chat/imagenes/ver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rutas }),
    });

    if (respuesta.ok) {
      const cuerpo = (await respuesta.json()) as { urls?: Record<string, string> };
      urls = cuerpo.urls ?? {};
    }
  } catch (error) {
    console.error("No se pudieron abrir las fotos de la conversación:", error);
  }

  return mensajes.map((m) => {
    if (!m.imagenes) return m;

    const imagenes = m.imagenes
      .map((i) => ({ ...i, src: i.ruta ? urls[i.ruta] : undefined }))
      .filter((i) => i.src);

    return imagenes.length > 0 ? { ...m, imagenes } : { ...m, imagenes: undefined };
  });
}

/**
 * Guarda UNA foto del chat. Devuelve `null` si no se pudo: el mensaje sale
 * igual, y esa foto queda nombrada solo en la línea de texto.
 */
export async function subirFotoDelChat(foto: {
  nombre: string;
  tipo: string;
  base64: string;
}): Promise<FotoGuardada | null> {
  try {
    const respuesta = await fetch("/api/chat/imagenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(foto),
    });

    if (!respuesta.ok) return null;

    const cuerpo = (await respuesta.json()) as Partial<FotoGuardada>;
    if (typeof cuerpo.ruta !== "string") return null;

    return { ruta: cuerpo.ruta, nombre: foto.nombre, tipo: foto.tipo };
  } catch (error) {
    console.error("No se pudo guardar la foto del chat:", error);
    return null;
  }
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
  texto: string,
  fotos: FotoGuardada[] = []
) {
  if (!conversacionId || !usuarioId || !texto.trim()) return;

  const { error } = await supabase.from("mensajes").insert([
    {
      conversacion_id: conversacionId,
      usuario_id: usuarioId,
      rol,
      texto,
      // Solo cuando hay fotos: `metadata` tiene default `{}` y no hace falta
      // mandarlo vacío en cada mensaje.
      ...(fotos.length > 0 ? { metadata: { imagenes: fotos } } : {}),
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
/**
 * Las conversaciones con algún mensaje que dice lo buscado, y el pedazo donde
 * lo dice (el mensaje más reciente que coincide). Lo usa el buscador de la
 * barra lateral: el título solo no alcanza para encontrar un chat.
 *
 * Con la sesión del usuario: la RLS de `mensajes` solo deja ver los suyos, y
 * además se filtra por `usuario_id` explícito.
 */
export async function buscarEnMensajes(
  usuarioId: string,
  consulta: string
): Promise<Record<string, string>> {
  if (!usuarioId || consulta.trim().length < MINIMO_PARA_BUSCAR) return {};

  const { data, error } = await supabase
    .from("mensajes")
    .select("conversacion_id, texto")
    .eq("usuario_id", usuarioId)
    .ilike("texto", patronIlike(consulta))
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("No se pudo buscar en los mensajes:", error);
    return {};
  }

  const coincidencias: Record<string, string> = {};

  for (const fila of data ?? []) {
    const id = typeof fila.conversacion_id === "string" ? fila.conversacion_id : "";
    if (!id || id in coincidencias) continue;

    const pedazo = fragmento(String(fila.texto ?? ""), consulta);
    if (pedazo) coincidencias[id] = pedazo;
  }

  return coincidencias;
}
