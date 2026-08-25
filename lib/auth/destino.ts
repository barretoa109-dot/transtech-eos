/*
 * A dónde se puede volver después de iniciar sesión.
 *
 * El destino viene en la URL (`?next=` o `?redirect=`), así que es entrada del
 * usuario como cualquier otra: sin una lista blanca, cualquiera puede armar
 * un `/login?next=https://otro-sitio` y usar nuestra pantalla de login como
 * trampolín, con nuestro dominio en la barra hasta el último segundo.
 *
 * La lista es corta a propósito: son las pantallas a las que tiene sentido
 * volver después de identificarse. Cualquier otra cosa cae en el chat, que es
 * donde el usuario quiere estar el 90% de las veces.
 */
export const DESTINOS_AUTH_PERMITIDOS = [
  "/eos/chat",
  "/eos/onboarding",
  "/planes",
  "/pago",
];

export const DESTINO_AUTH_POR_DEFECTO = "/eos/chat";

/**
 * Devuelve una ruta interna segura, o el chat si el destino no sirve.
 *
 * Conserva la query: `/pago/tarjeta?plan=pro` sin el plan es otra pantalla.
 */
export function destinoSeguro(raw: string | null, origin: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return DESTINO_AUTH_POR_DEFECTO;
  }

  try {
    const destino = new URL(raw, origin);

    if (destino.origin !== origin) {
      return DESTINO_AUTH_POR_DEFECTO;
    }

    const permitido = DESTINOS_AUTH_PERMITIDOS.some(
      (base) =>
        destino.pathname === base || destino.pathname.startsWith(`${base}/`),
    );

    if (!permitido) {
      return DESTINO_AUTH_POR_DEFECTO;
    }

    return `${destino.pathname}${destino.search}`;
  } catch {
    return DESTINO_AUTH_POR_DEFECTO;
  }
}

/**
 * El destino pedido en la URL del navegador.
 *
 * Se lee de `window.location` y no con `useSearchParams` a propósito: esto se
 * llama dentro de un manejador de evento, que sólo corre en el cliente, y así
 * la pantalla de login no necesita un Suspense ni deja de renderizarse
 * estáticamente.
 */
export function destinoPedido(): string {
  if (typeof window === "undefined") return DESTINO_AUTH_POR_DEFECTO;

  const params = new URLSearchParams(window.location.search);

  return destinoSeguro(
    params.get("next") || params.get("redirect"),
    window.location.origin,
  );
}
