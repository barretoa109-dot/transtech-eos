/**
 * La capa de texto de un PDF, con `unpdf` (build de pdf.js para serverless:
 * sin binarios nativos, funciona en Vercel).
 *
 * Compartido entre `/api/documents/ingest` (cualquier PDF que alguien
 * adjunta) y `lib/facturacion/leerKude.ts` (el KuDE que un proveedor manda
 * por correo): las dos cañerías necesitan lo mismo — la capa de texto o,
 * explícitamente, que no hay ninguna — y escribirlo dos veces es la forma en
 * que una de las dos copias se desactualiza sin que nadie lo note.
 *
 * No confundir con `lib/documentos/pdf.ts`, que es lo opuesto: ARMA un PDF
 * para imprimir, no lee uno existente.
 */
export type TextoPdf = { texto: string; paginas: number };

/**
 * Umbral bajo a propósito: con menos de esto no hay nada útil que leer y casi
 * siempre significa que el PDF es una imagen escaneada sin capa de texto.
 */
const MIN_CARACTERES = 20;

export async function extraerTextoPdf(bytes: Uint8Array): Promise<TextoPdf | null> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  const contenido = (Array.isArray(text) ? text.join("\n") : text) ?? "";
  const limpio = contenido.replace(/\u0000/g, "").trim();

  if (limpio.replace(/\s/g, "").length < MIN_CARACTERES) return null;

  return { texto: limpio, paginas: totalPages };
}
