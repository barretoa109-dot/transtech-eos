/**
 * Etapa 1 de `docs/salida-de-n8n.md`: normalizar la entrada del gateway.
 *
 * Es el puerto del nodo `01 GW Preparar Entrada`, 2,8 KB de JavaScript que
 * hoy viven en Railway, fuera de TypeScript y fuera de los tests. Acá adentro
 * no hay ningún efecto durable: strings, JSON y nada más. Por eso es la parte
 * que se puede mover primero y con red.
 *
 * Lo único que realmente hace falta portar es la clasificación del archivo,
 * porque `app/api/eos/route.ts` ya valida los UUID y el mensaje antes de armar
 * el payload. Se conserva igual la validación de forma: el día que este camino
 * sea el único, el que tiene que gritar si llega algo raro es este archivo.
 */

export type ArchivoEntrada = {
  nombre: string;
  tipo: string;
  tamanio: number;
  base64: string;
};

export type Categoria = "imagen" | "pdf" | "word" | "excel" | "csv" | "texto" | "otro" | "";

export type Entrada = {
  request_id: string;
  usuario_id: string;
  conversacion_id: string;
  nombre: string;
  mensaje: string;
  plan: string;
  contexto_negocio: string;
  origen: string;
  historial: HistorialItem[];
  archivo: ArchivoEntrada | null;
  tiene_archivo: boolean;
  archivo_categoria: Categoria;
  archivo_nombre: string;
  archivo_tipo: string;
  archivo_tamanio: number;
  /** Data URL lista para mandar a OpenAI. Vacía si no hay imagen. */
  imagen_data_url: string;
};

export type HistorialItem = {
  rol?: unknown;
  role?: unknown;
  texto?: unknown;
  mensaje?: unknown;
  content?: unknown;
};

/** El contexto del negocio se recorta: entra en CADA llamada a OpenAI. */
export const TOPE_CONTEXTO = 2000;

/** Solo los últimos diez turnos, igual que n8n. */
export const TURNOS_DE_HISTORIAL = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function limpio(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * De qué tipo es el archivo adjunto.
 *
 * El orden importa: un `.docx` llega como
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
 * que contiene "officedocument" igual que un `.xlsx`. Preguntar por word
 * antes que por excel es lo que evita que un documento se clasifique como
 * planilla.
 */
export function categoriaDe(tipo: string): Categoria {
  const t = tipo.toLowerCase();
  if (!t) return "";
  if (t.startsWith("image/")) return "imagen";
  if (t === "application/pdf") return "pdf";
  if (t.includes("word") || t.includes("officedocument.wordprocessingml")) return "word";
  if (t.includes("excel") || t.includes("spreadsheet")) return "excel";
  if (t === "text/csv") return "csv";
  if (t.startsWith("text/")) return "texto";
  return "otro";
}

export class EntradaInvalida extends Error {}

/**
 * Normaliza el payload que hoy se le manda a n8n.
 *
 * Lanza `EntradaInvalida` con el mismo criterio que el nodo 01: sin
 * `request_id` no hay idempotencia, sin `usuario_id` no hay a quién
 * responderle, y sin mensaje no hay nada que responder.
 */
export function prepararEntrada(body: Record<string, unknown>): Entrada {
  const request_id = limpio(body.request_id);
  if (!UUID.test(request_id)) {
    throw new EntradaInvalida("request_id debe ser un UUID válido y conservarse desde /api/eos.");
  }

  const usuario_id = limpio(body.usuario_id ?? body.user_id ?? body.userId);
  if (!UUID.test(usuario_id)) {
    throw new EntradaInvalida("usuario_id debe ser un UUID válido de Supabase.");
  }

  const conversacion_id = limpio(body.conversacion_id ?? body.conversation_id ?? body.conversationId);
  if (!UUID.test(conversacion_id)) {
    throw new EntradaInvalida("conversacion_id debe ser un UUID válido.");
  }

  const mensaje = limpio(body.mensaje ?? body.message ?? body.text);
  if (!mensaje) throw new EntradaInvalida("mensaje es obligatorio.");

  let archivo: ArchivoEntrada | null = null;
  const crudo = body.archivo;
  if (crudo && typeof crudo === "object" && !Array.isArray(crudo)) {
    const a = crudo as Record<string, unknown>;
    const nombre = limpio(a.nombre);
    const tipo = limpio(a.tipo);
    const base64 = limpio(a.base64);
    // Los tres tienen que estar: un adjunto sin contenido no es un adjunto, y
    // arrastrarlo a medias haría que el prompt anuncie una imagen que no va.
    if (nombre && tipo && base64) {
      archivo = { nombre, tipo, base64, tamanio: Number(a.tamanio ?? 0) || 0 };
    }
  }

  const archivo_categoria = archivo ? categoriaDe(archivo.tipo) : "";

  const imagen_data_url =
    archivo && archivo_categoria === "imagen"
      ? archivo.base64.startsWith("data:")
        ? archivo.base64
        : `data:${archivo.tipo};base64,${archivo.base64}`
      : "";

  return {
    request_id,
    usuario_id,
    conversacion_id,
    nombre: limpio(body.nombre ?? body.name ?? body.usuario_nombre) || "Usuario",
    mensaje,
    plan: limpio(body.plan) || "free",
    contexto_negocio: String(body.contexto_negocio ?? "").slice(0, TOPE_CONTEXTO),
    origen: limpio(body.origen) || "eos-web",
    historial: Array.isArray(body.historial)
      ? (body.historial as HistorialItem[]).slice(-TURNOS_DE_HISTORIAL)
      : [],
    archivo,
    tiene_archivo: archivo !== null,
    archivo_categoria,
    archivo_nombre: archivo?.nombre ?? "",
    archivo_tipo: archivo?.tipo ?? "",
    archivo_tamanio: archivo?.tamanio ?? 0,
    imagen_data_url,
  };
}
