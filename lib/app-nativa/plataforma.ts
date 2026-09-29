/**
 * La app nativa (Capacitor, iOS y Android) carga la misma web que el
 * navegador. Este módulo es lo único que distingue una de otra, y es puro
 * para que el proxy, las rutas de la API y los componentes respondan igual.
 *
 * Por qué hace falta distinguirlas: fuera de Estados Unidos, Apple no deja
 * que una app muestre compras que no pasen por su sistema, ni botones o
 * enlaces que lleven a pagar afuera (App Review Guidelines 3.1.1 y 3.1.3), y
 * Google Play exige su propio cobro para servicios de software. Mientras EOS
 * se contrate solo en la web, la app nativa no muestra precios, planes ni
 * pagos. Ver `docs/app-nativa/tiendas.md`.
 */

/**
 * Lo que `capacitor.config.ts` agrega al final del user agent del WebView
 * (`appendUserAgent`). Si se cambia allá, se cambia acá: un test compara los
 * dos archivos.
 */
export const MARCA_APP_NATIVA = "EOSApp/1";

/** El esquema propio de la app, para volver del inicio de sesión con Google o Apple. */
export const ESQUEMA_APP = "com.transtech.eos";

const PATRON_MARCA = /(?:^|\s)EOSApp\/\d+(?:\s|$)/;

/** ¿Este user agent es el de la app nativa? */
export function esAppNativa(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && PATRON_MARCA.test(userAgent);
}

const RUTAS_DE_COMPRA = ["/planes", "/pago"];

/** Rutas donde se elige un plan o se paga. La app nativa no las abre. */
export function esRutaDeCompra(pathname: string): boolean {
  return RUTAS_DE_COMPRA.some(
    (ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`),
  );
}

/** A dónde va la app nativa cuando algo la manda a una ruta de compra. */
export const DESTINO_EN_APP = "/eos/chat";

/** La dirección a la que Google o Apple devuelven a la app después de iniciar sesión. */
export function redireccionOAuthApp(next: string): string {
  return `${ESQUEMA_APP}://auth/callback?next=${encodeURIComponent(next)}`;
}

const PARAMETROS_DEL_CALLBACK = ["code", "next", "error", "error_code", "error_description"];

/**
 * Convierte el enlace con el que el sistema reabre la app
 * (`com.transtech.eos://auth/callback?code=…&next=…`) en la ruta del callback
 * web de siempre, en el mismo origen del WebView. Ahí vive la cookie con el
 * verificador PKCE que dejó `signInWithOAuth`, así que el intercambio del
 * código lo sigue haciendo `app/auth/callback/route.ts`, sin código nuevo en
 * el servidor.
 *
 * Solo deja pasar los parámetros del callback: cualquier otro enlace con el
 * esquema de la app devuelve `null` y no navega a ninguna parte.
 */
export function callbackDesdeEnlaceApp(enlace: string, origen: string): string | null {
  let url: URL;
  try {
    url = new URL(enlace);
  } catch {
    return null;
  }

  if (url.protocol !== `${ESQUEMA_APP}:`) return null;

  // `com.transtech.eos://auth/callback` se lee como host "auth" y ruta "/callback".
  const ruta = `${url.host}${url.pathname}`.replace(/\/+$/, "");
  if (ruta !== "auth/callback") return null;

  const destino = new URL("/auth/callback", origen);
  for (const nombre of PARAMETROS_DEL_CALLBACK) {
    const valor = url.searchParams.get(nombre);
    if (valor !== null) destino.searchParams.set(nombre, valor);
  }

  // Sin código ni error no hay nada que resolver.
  if (!destino.searchParams.has("code") && !destino.searchParams.has("error")) return null;

  return `${destino.pathname}${destino.search}`;
}
