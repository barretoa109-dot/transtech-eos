/**
 * Convierte una imagen compartida desde la app nativa (base64, ver
 * CompartirRecibidoPlugin.java) en un `File`, para que entre por el mismo camino
 * que un adjunto elegido con el clip. Pura y probada.
 */
export function archivoDesdeCompartido(compartido: {
  nombre: string;
  mime: string;
  base64: string;
}): File {
  const binario = atob(compartido.base64);
  const bytes = Uint8Array.from(binario, (caracter) => caracter.charCodeAt(0));
  return new File([bytes], compartido.nombre, { type: compartido.mime });
}
