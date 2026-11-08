import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/*
 * Flujo implícito, solo para el enlace de recuperación de contraseña.
 *
 * El flujo PKCE (el de `createClient()`) guarda el "verificador" en una
 * cookie del navegador que pide el enlace, y exige esa misma cookie para
 * canjear el código cuando se lo abre. Un enlace de correo casi nunca se abre
 * en ese mismo navegador — se abre desde Gmail, Outlook, etc. — así que el
 * canje falla con "sesión no válida" aunque el enlace tenga segundos de
 * vida. El flujo implícito no depende de ningún estado guardado: el enlace
 * mismo trae todo lo necesario para abrir la sesión.
 */
export function crearClienteDeRecuperacion() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit" } }
  );
}
