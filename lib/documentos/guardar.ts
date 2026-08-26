import { normalizarDocumento, type Documento } from "./especificacion.ts";

/**
 * Guardar un documento que EOS acaba de armar.
 *
 * Vive acá y no dentro de una ruta porque hay DOS caminos que llegan al mismo
 * lugar: el chat, donde el documento viene pegado a la respuesta de EOS, y la
 * ruta `POST /api/documentos`, donde lo pide la propia app. Si cada uno hiciera
 * su insert, el día que se agregue una columna quedaría llena en un camino y
 * vacía en el otro, y los documentos servirían distinto según de dónde
 * salieron.
 *
 * El id que devuelve es lo único que necesita el enlace de descarga: el archivo
 * se dibuja recién cuando alguien lo baja (ver la migración
 * `20260826140000_eos_documentos_generados_v64.sql`).
 */

export type FormatoDocumento = "excel" | "pdf" | "word";

export const FORMATOS: Record<FormatoDocumento, { extension: string; tipo: string; etiqueta: string }> = {
  excel: {
    extension: "xlsx",
    tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    etiqueta: "Excel",
  },
  pdf: { extension: "pdf", tipo: "application/pdf", etiqueta: "PDF" },
  word: {
    extension: "docx",
    tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    etiqueta: "Word",
  },
};

export function esFormato(valor: unknown): valor is FormatoDocumento {
  return typeof valor === "string" && valor in FORMATOS;
}

/**
 * Qué formato quiso el usuario, deducido de cómo lo pidió.
 *
 * "Pasámelo en Excel" y "mandame el PDF" son la forma normal de pedirlo; si EOS
 * no declaró el formato, esto lo saca del texto antes de caer en el que está
 * por defecto. Se equivoca poco y cuando se equivoca no importa: los otros dos
 * formatos siguen a un clic.
 */
export function formatoPedido(texto: string, declarado?: unknown): FormatoDocumento {
  if (esFormato(declarado)) return declarado;

  const limpio = texto.toLowerCase();

  if (/\b(pdf)\b/.test(limpio)) return "pdf";
  if (/\b(word|docx?|documento de word)\b/.test(limpio)) return "word";
  if (/\b(excel|xlsx?|planilla|hoja de c[áa]lculo|tabla)\b/.test(limpio)) return "excel";

  return "excel";
}

export type Guardado = {
  id: string;
  titulo: string;
  formato: FormatoDocumento;
  /** La ruta de descarga, ya con el formato adentro. */
  url: string;
  nombreArchivo: string;
  recortes: string[];
};

/** "cuadro-de-necesidades.xlsx" */
export function nombreDeArchivo(titulo: string, formato: FormatoDocumento): string {
  const base =
    titulo
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "documento";

  return `${base}.${FORMATOS[formato].extension}`;
}

export async function guardarDocumento(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no incluyen esta tabla
  admin: any,
  datos: {
    usuarioId: string;
    conversacionId?: string | null;
    documento: Documento;
    formato: FormatoDocumento;
    recortes?: string[];
  },
): Promise<Guardado | null> {
  const { data, error } = await admin
    .from("eos_documentos_generados")
    .insert({
      usuario_id: datos.usuarioId,
      conversacion_id: datos.conversacionId || null,
      titulo: datos.documento.titulo,
      especificacion: datos.documento,
      formato: datos.formato,
      recortes: datos.recortes ?? [],
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    console.error("Documentos: no se pudo guardar el documento generado:", error);
    return null;
  }

  return {
    id: String(data.id),
    titulo: datos.documento.titulo,
    formato: datos.formato,
    url: `/api/documentos/${data.id}?formato=${datos.formato}`,
    nombreArchivo: nombreDeArchivo(datos.documento.titulo, datos.formato),
    recortes: datos.recortes ?? [],
  };
}

/**
 * Buscar la descripción de un documento dentro de lo que contestó EOS.
 *
 * Se aceptan dos formas a propósito, porque el flujo del chat vive en n8n y no
 * en este repositorio: si mañana el workflow manda el documento en un campo
 * aparte, ya funciona; y mientras tanto alcanza con que el modelo escriba un
 * bloque cercado en su respuesta, que no requiere tocar el workflow.
 *
 *   1. Un campo `documento` en el JSON de la respuesta (o dentro de `metadata`).
 *   2. Un bloque ```eos:documento { ... } ``` en el texto.
 *
 * Devuelve también el texto SIN el bloque: el JSON crudo no puede quedar en la
 * burbuja del chat.
 */
export function extraerDocumento(
  texto: string,
  datos: Record<string, unknown>,
): { documento: Documento | null; texto: string; motivo?: string; recortes: string[] } {
  const metadata =
    datos.metadata && typeof datos.metadata === "object" && !Array.isArray(datos.metadata)
      ? (datos.metadata as Record<string, unknown>)
      : {};

  const declarado = datos.documento ?? metadata.documento ?? null;

  if (declarado) {
    const resultado = normalizarDocumento(declarado);
    return resultado.ok
      ? { documento: resultado.documento, texto, recortes: resultado.recortes }
      : { documento: null, texto, motivo: resultado.motivo, recortes: [] };
  }

  const bloque = texto.match(/```eos:documento\s*([\s\S]*?)```/i);
  if (!bloque) return { documento: null, texto, recortes: [] };

  const limpio = texto.replace(bloque[0], "").replace(/\n{3,}/g, "\n\n").trim();
  const resultado = normalizarDocumento(bloque[1].trim());

  return resultado.ok
    ? { documento: resultado.documento, texto: limpio, recortes: resultado.recortes }
    : { documento: null, texto: limpio, motivo: resultado.motivo, recortes: [] };
}
