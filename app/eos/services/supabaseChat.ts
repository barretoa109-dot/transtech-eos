import { supabase } from "../../../lib/supabase";
import { fotosDeMetadata, type FotoGuardada } from "@/lib/eos/fotos-chat";
import { MINIMO_PARA_BUSCAR, fragmento, patronIlike } from "@/lib/eos/buscar-chats";
import type { Conversacion, Mensaje } from "../types/chat";
import { tituloProvisional } from "@/lib/eos/titulo-chat";

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

/**
 * El título provisional, apenas se manda el primer mensaje: sale del mensaje,
 * no de una categoría. Con la primera respuesta lo reemplaza uno escrito por
 * un modelo (/api/eos/titulo, lib/eos/titulo-chat.ts).
 */
export async function actualizarTituloConversacion(
  conversacionId: string,
  textoUsuario: string
) {
  const titulo = tituloProvisional(textoUsuario);

  await supabase.from("conversaciones").update({ titulo }).eq("id", conversacionId);

  return titulo;
}

/** Pide el título escrito por el modelo. Devuelve el nuevo, o null si no cambió. */
export async function pedirTituloInteligente(conversacionId: string): Promise<{ titulo: string | null; sinTema: boolean }> {
  try {
    const r = await fetch("/api/eos/titulo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversacion_id: conversacionId }),
    });
    const data = (await r.json().catch(() => null)) as { titulo?: string; cambiado?: boolean; sin_tema?: boolean } | null;
    return { titulo: data?.cambiado && data.titulo ? data.titulo : null, sinTema: data?.sin_tema === true };
  } catch {
    return { titulo: null, sinTema: false };
  }
}
/** Lo más largo que se deja poner a mano como título de un chat. */
export const MAX_TITULO_CHAT = 80;

/** Devuelve el título que quedó guardado, o `null` si no se pudo. */
export async function renombrarConversacion(conversacionId: string, titulo: string): Promise<string | null> {
  const limpio = titulo.replace(/\s+/g, " ").trim().slice(0, MAX_TITULO_CHAT);
  if (!limpio) return null;

  const { error } = await supabase.from("conversaciones").update({ titulo: limpio }).eq("id", conversacionId);

  if (error) {
    console.error("No se pudo renombrar la conversación:", error);
    return null;
  }

  return limpio;
}

/**
 * Archivar o sacar de archivados. Devuelve la fecha que quedó (null al
 * desarchivar), o `undefined` si no se pudo — por ejemplo, si la v210 todavía
 * no corrió y la columna no existe.
 */
export async function archivarConversacion(
  conversacionId: string,
  archivar: boolean,
): Promise<string | null | undefined> {
  const archivadaAt = archivar ? new Date().toISOString() : null;

  const { error } = await supabase
    .from("conversaciones")
    .update({ archivada_at: archivadaAt })
    .eq("id", conversacionId);

  if (error) {
    console.error("No se pudo archivar la conversación:", error);
    return undefined;
  }

  return archivadaAt;
}

/** Con sus mensajes y sus fotos: ver `app/api/chat/conversaciones/[id]`. */
export async function eliminarConversacion(conversacionId: string): Promise<boolean> {
  try {
    const respuesta = await fetch(`/api/chat/conversaciones/${encodeURIComponent(conversacionId)}`, {
      method: "DELETE",
    });
    return respuesta.ok;
  } catch (error) {
    console.error("No se pudo eliminar la conversación:", error);
    return false;
  }
}

/**
 * La conversación como texto, para mandarla por WhatsApp o por correo.
 *
 * Es texto y no un enlace a propósito: un enlace público dejaría la
 * conversación al alcance de cualquiera que lo reciba o lo reenvíe, y el
 * chat tiene números del negocio. Con el texto, la persona ve exactamente
 * qué está mandando antes de mandarlo.
 */
export async function textoParaCompartir(conversacionId: string, titulo: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("mensajes")
    .select("rol, texto")
    .eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("No se pudo leer la conversación para compartir:", error);
    return null;
  }

  const cuerpo = (data ?? [])
    .map((m) => ({ quien: m.rol === "usuario" ? "Yo" : "EOS", texto: String(m.texto ?? "").trim() }))
    .filter((m) => m.texto)
    .map((m) => `${m.quien}:\n${m.texto}`)
    .join("\n\n");

  return `${titulo}\n\n${cuerpo || "(Sin mensajes todavía)"}\n\n— Conversación con TransTech EOS`;
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
