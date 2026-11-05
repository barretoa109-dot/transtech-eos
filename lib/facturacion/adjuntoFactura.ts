/**
 * Cuál de los adjuntos de un correo es candidato a ser un KuDE.
 *
 * Pura, sin I/O: separada de `leerKude` para poder probarla sin tocar la red
 * ni el proveedor de IA. Un correo de proveedor puede traer el PDF del KuDE,
 * el XML del Documento Electrónico y hasta el logo de la empresa en la firma
 * — de los tres, solo el primero es candidato: el XML no se parsea (ver
 * `leerKude.ts`) y una imagen que no sea de la foto del documento (un logo)
 * sería leer cualquier cosa y guardarla como si fuera una factura.
 */

export type AdjuntoCrudo = {
  id: string;
  filename: string | null;
  content_type: string;
  size: number;
};

export type AdjuntoElegido = { id: string; esImagen: boolean };

/** Por encima de esto no vale la pena bajarlo: ni un KuDE pesa tanto. */
export const MAX_BYTES_ADJUNTO = 8 * 1024 * 1024;

/**
 * Señales de que la imagen es decorativa (firma, logo), no el documento.
 * Los proveedores de correo nombran así los adjuntos incrustados en el HTML.
 */
const NOMBRES_DECORATIVOS = /^(image0*1?|logo|firma|signature|icon)\b/i;

export function elegirAdjuntoFactura(adjuntos: AdjuntoCrudo[]): AdjuntoElegido | null {
  const candidatos = adjuntos.filter((a) => a.size > 0 && a.size <= MAX_BYTES_ADJUNTO);

  const pdf = candidatos.find((a) => a.content_type === "application/pdf");
  if (pdf) return { id: pdf.id, esImagen: false };

  const imagen = candidatos.find(
    (a) => a.content_type.startsWith("image/") && !NOMBRES_DECORATIVOS.test(a.filename ?? ""),
  );
  if (imagen) return { id: imagen.id, esImagen: true };

  return null;
}
