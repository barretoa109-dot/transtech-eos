/**
 * Varias fotos con un pie de foto son UN pedido, no tres (v199, 25/09/2026).
 *
 * WhatsApp no manda un álbum como un mensaje: manda cada foto por separado y
 * el texto va pegado a una sola. Sofía mandó dos capturas con "Pasame estas 6
 * prendas a guaraníes" y EOS contestó tres veces: la foto con el texto ("se
 * ven 2 prendas, no 6"), la foto sin texto (la describió y no convirtió nada)
 * y un aviso falso de que no podía leer imágenes. Ver la migración v199.
 *
 * Acá vive lo que no necesita red ni base, para poder probarlo: qué se anota
 * de cada mensaje y cómo se junta un lote en un solo pedido. El webhook
 * (`app/api/whatsapp/webhook/route.ts`) hace la espera y la descarga.
 */

/** Lo que se espera, desde el último mensaje, antes de dar la ráfaga por terminada. */
export const ESPERA_RAFAGA_MS = 4000;

export type MensajeWhatsapp = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  audio?: { id?: string; mime_type?: string };
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

/** Una fila de `eos_whatsapp_rafaga_v199`, sin lo que pone la base. */
export type EntradaRafaga = {
  wa_id: string;
  telefono: string;
  tipo: string;
  texto: string | null;
  media_id: string | null;
  mime_type: string | null;
  nombre_archivo: string | null;
};

export type FilaRafaga = EntradaRafaga & { id: number; recibido_en: string };

/*
 * Lo que no es contenido y no merece respuesta: una reacción con emoji, un
 * aviso del sistema ("cambió de número"). Contestarle "no puedo leer esto" a
 * un 👍 es peor que no decir nada.
 */
const SIN_RESPUESTA = new Set(["reaction", "system", "ephemeral", "request_welcome"]);

/** Los que el motor entiende. */
const LEGIBLES = new Set(["text", "image", "document", "audio"]);

/**
 * Qué se anota de un mensaje. `null` si no hay nada que anotar: sin id, sin
 * remitente, o un tipo que no merece respuesta.
 */
export function entradaDeMensaje(m: MensajeWhatsapp): EntradaRafaga | null {
  const wa_id = String(m.id || "").trim();
  const telefono = String(m.from || "").trim();
  const tipo = String(m.type || "desconocido").trim();
  if (!wa_id || !telefono || SIN_RESPUESTA.has(tipo)) return null;

  const base = { wa_id, telefono, tipo, texto: null, media_id: null, mime_type: null, nombre_archivo: null };

  if (tipo === "text") return { ...base, texto: String(m.text?.body || "").trim() || null };

  if (tipo === "image" || tipo === "document" || tipo === "audio") {
    const media = tipo === "image" ? m.image : tipo === "document" ? m.document : m.audio;
    const pie = tipo === "audio" ? "" : String((media as { caption?: string } | undefined)?.caption || "").trim();
    return {
      ...base,
      texto: pie || null,
      media_id: media?.id || null,
      mime_type: media?.mime_type || null,
      nombre_archivo:
        (tipo === "document" ? (media as { filename?: string } | undefined)?.filename : undefined) ||
        `whatsapp-${tipo}`,
    };
  }

  return base;
}

export type Lote = {
  /** Los textos y pies de foto, en el orden en que llegaron. */
  texto: string;
  /** Los adjuntos a descargar, en orden. */
  medios: Array<{ media_id: string; mime_type: string; nombre: string }>;
  /** Tipos que llegaron y el motor no lee (video, sticker, "unsupported"...). */
  noLegibles: string[];
  /** El último mensaje del lote: de él sale el id del pedido. */
  ultimoId: string;
};

export function unirLote(filas: FilaRafaga[]): Lote {
  const orden = filas
    .slice()
    .sort((a, b) => (a.recibido_en === b.recibido_en ? a.id - b.id : a.recibido_en < b.recibido_en ? -1 : 1));

  const textos: string[] = [];
  const medios: Lote["medios"] = [];
  const noLegibles: string[] = [];
  const cuantos = new Map<string, number>();

  for (const f of orden) {
    if (!LEGIBLES.has(f.tipo)) {
      noLegibles.push(f.tipo);
      continue;
    }
    if (f.texto && !textos.includes(f.texto)) textos.push(f.texto);
    if (f.media_id) {
      // "whatsapp-image-2", no dos "whatsapp-image": el modelo las nombra.
      const n = (cuantos.get(f.tipo) ?? 0) + 1;
      cuantos.set(f.tipo, n);
      const nombre = f.nombre_archivo || `whatsapp-${f.tipo}`;
      medios.push({
        media_id: f.media_id,
        mime_type: f.mime_type || "",
        nombre: f.tipo === "document" || n === 1 ? nombre : `${nombre}-${n}`,
      });
    }
  }

  return { texto: textos.join("\n\n"), medios, noLegibles, ultimoId: orden[orden.length - 1]?.wa_id ?? "" };
}

/**
 * Qué decir cuando lo ÚNICO que llegó es algo que el motor no lee.
 *
 * Nunca "no puedo leer imágenes": el aviso viejo decía "puedo leer texto,
 * imágenes..." a alguien que acababa de mandar imágenes, que es exactamente lo
 * que la hizo pensar que EOS no funcionaba. Se dice qué fue lo que no llegó.
 */
export function avisoNoLegible(tipos: string[]): string {
  if (tipos.includes("video")) {
    return "Los videos todavía no los puedo ver. Si me mandás una captura de lo que querés que mire, lo reviso.";
  }
  if (tipos.includes("sticker")) return "";
  if (tipos.includes("location")) return "Las ubicaciones todavía no las leo. Escribime la dirección y sigo.";
  if (tipos.includes("contacts")) return "Los contactos compartidos todavía no los leo. Escribime el nombre y el número y lo cargo.";
  return "Ese mensaje no me llegó completo desde WhatsApp. Si era una foto o un archivo, mandalo de nuevo y lo miro.";
}
