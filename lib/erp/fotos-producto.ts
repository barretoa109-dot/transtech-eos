/**
 * Las fotos del catálogo (v232).
 *
 * Mismo esquema que las fotos del chat (`lib/eos/fotos-chat.ts`): bucket
 * privado, el servidor sube con la clave de servicio y la pantalla recibe un
 * enlace firmado que vence. La fila del producto guarda solo la ruta.
 *
 * La ruta empieza por la empresa y no por la persona: el catálogo es del
 * negocio (`empresa_id`), y cuando lo atienda más de una persona la foto que
 * subió una la tiene que ver la otra.
 */

export const BUCKET_FOTOS_PRODUCTO = "eos-productos-fotos";

/** Lo mismo que el bucket acepta (2 MB). La pantalla achica antes de subir. */
export const MAX_BYTES_FOTO_PRODUCTO = 2 * 1024 * 1024;

/** Una hora: alcanza para mirar el catálogo sin que las fotos se rompan. */
export const SEGUNDOS_ENLACE_FOTO_PRODUCTO = 60 * 60;

const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function tipoDeFotoProducto(tipo: unknown): string | null {
  if (typeof tipo !== "string") return null;
  const limpio = tipo.toLowerCase();
  return Object.prototype.hasOwnProperty.call(EXTENSIONES, limpio) ? limpio : null;
}

export function rutaDeFotoProducto(empresaId: string, productoId: string, id: string, tipo: string): string {
  return `${empresaId}/${productoId}-${id}.${EXTENSIONES[tipo] ?? "jpg"}`;
}

/** Que la ruta sea de esta empresa y tenga la forma que arma `rutaDeFotoProducto`. */
export function rutaDeFotoEsDe(empresaId: string, ruta: unknown): ruta is string {
  if (!empresaId || typeof ruta !== "string") return false;
  const partes = ruta.split("/");
  return (
    partes.length === 2 &&
    partes[0] === empresaId &&
    /^[0-9a-f-]{36}-[A-Za-z0-9-]{1,64}\.(jpg|png|webp)$/i.test(partes[1])
  );
}

/** La categoría como la escribe la persona, sin espacios de más. Vacía es "sin categoría". */
export function categoriaLimpia(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpia = valor.replace(/\s+/g, " ").trim().slice(0, 60);
  return limpia.length > 0 ? limpia : null;
}
