/**
 * El texto que se manda por WhatsApp cuando la respuesta trae un archivo.
 *
 * Un documento guardado por EOS (`/api/documentos/<id>?formato=…`) no va como
 * enlace: exige sesión, así que se manda el archivo adjunto aparte. Cualquier
 * otro enlace absoluto (por ejemplo la planilla de `/descargar`) se agrega al
 * final para que WhatsApp lo muestre tocable, salvo que el texto ya lo traiga:
 * la respuesta del Excel ya dice "Descargar archivo: <enlace>" y pegarlo de
 * nuevo lo mostraba dos veces.
 */
export const DOCUMENTO_GUARDADO = /^\/api\/documentos\/([0-9a-f-]{36})\?formato=([a-z]+)$/i;

export function textoConEnlace(respuesta: string, archivoUrl: string): string {
  const url = archivoUrl.trim();
  if (!url || DOCUMENTO_GUARDADO.test(url) || !/^https?:\/\//i.test(url)) return respuesta;
  if (respuesta.includes(url)) return respuesta;
  return `${respuesta}\n\n${url}`;
}
