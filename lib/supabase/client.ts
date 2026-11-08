import { createBrowserClient } from "@supabase/ssr";
import { createClient as createClienteBase } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/*
 * Flujo implícito, solo para pedir el enlace de recuperación de contraseña.
 *
 * El flujo PKCE (el de `createClient()`) guarda el "verificador" en una
 * cookie del navegador que pide el enlace, y exige esa misma cookie para
 * canjear el código cuando se lo abre. Un enlace de correo casi nunca se abre
 * en ese mismo navegador — se abre desde Gmail, Outlook, etc. — así que el
 * canje falla con "sesión no válida" aunque el enlace tenga segundos de
 * vida. El flujo implícito no depende de ningún estado guardado: el enlace
 * mismo trae todo lo necesario para abrir la sesión.
 *
 * `createBrowserClient` de `@supabase/ssr` no sirve para esto: fuerza
 * `flowType: "pkce"` por adentro pase lo que se le pase, así que acá se usa
 * el cliente base de `@supabase/supabase-js` directamente. No hace falta que
 * comparta cookies ni sesión con el resto de la app: esta llamada es anónima
 * (solo dispara el correo) y no se usa para nada más.
 */
export function crearClienteDeRecuperacion() {
  return createClienteBase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false } }
  );
}
