/**
 * Un documento pedido por el chat, sin el módulo que permite bajarlo.
 *
 * Armar el archivo lo hace EOS en cualquier plan; bajarlo es lo que se contrata
 * ("Documentos a pedido", `app/api/documentos/[id]/route.ts`). Antes el chat
 * guardaba el archivo y mandaba el enlace igual, y la persona tocaba un enlace
 * que devolvía un error. Ahora no se manda el enlace: la respuesta dice qué
 * falta y dónde se activa.
 */

export const AVISO_SIN_DOCUMENTOS =
  "Para bajarlo en Excel, PDF o Word hace falta el módulo **Documentos a pedido**. Lo activás en Planes, y después me lo pedís de nuevo y te paso el archivo.";

/** La respuesta de EOS con el aviso al final, una sola vez. */
export function respuestaSinDocumentos(respuesta: string | undefined | null): string {
  const texto = (respuesta ?? "").trim();
  if (texto.includes(AVISO_SIN_DOCUMENTOS)) return texto;
  return texto ? `${texto}\n\n${AVISO_SIN_DOCUMENTOS}` : AVISO_SIN_DOCUMENTOS;
}
