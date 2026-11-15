/**
 * A dónde lleva tocar una notificación.
 *
 * Cada aviso viaja con una `url` (`/eos/chat?vista=calendario` en los de
 * agenda), pero hasta el 2026-11-15 nadie la leía: tocar un aviso abría la
 * app donde hubiera quedado. Un aviso que dice "tu agenda de hoy" y abre el
 * chat vacío es una promesa a medias.
 *
 * Solo se aceptan rutas INTERNAS. Lo que llega en una notificación es un
 * dato externo: si alguna vez saliera un aviso con una dirección de afuera,
 * la app no tiene que navegar a ella por el solo hecho de que la tocaron.
 */
export function rutaDeAviso(datos: unknown): string | null {
  if (!datos || typeof datos !== "object") return null;

  const url = (datos as { url?: unknown }).url;
  if (typeof url !== "string") return null;

  const ruta = url.trim();
  // "/algo" sí; "//otro.sitio" y "/\otro.sitio" son direcciones de afuera disfrazadas.
  if (!ruta.startsWith("/") || ruta.startsWith("//") || ruta.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(ruta)) return null;

  return ruta;
}
