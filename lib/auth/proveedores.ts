/**
 * Qué formas de entrar están realmente habilitadas.
 *
 * ============================================================
 * POR QUÉ SE PREGUNTA Y NO SE ESCRIBE A MANO
 * ============================================================
 *
 * Habilitar Google o Apple no es trabajo de código: son credenciales que
 * alguien carga en el panel de Supabase y en el del proveedor. El código sólo
 * puede poner o sacar un botón.
 *
 * Si el botón se pone antes de que las credenciales existan, quien lo aprieta
 * recibe "Unsupported provider: provider is not enabled" y se va. Si se pone
 * después, hace falta acordarse de tocar el código y desplegar el día que se
 * configure — y nadie se acuerda.
 *
 * Preguntándole a Supabase qué tiene habilitado, el botón aparece solo el día
 * que se prende el interruptor, sin desplegar nada. Y desaparece solo si algún
 * día se apaga.
 *
 * El endpoint es público (pide la clave anónima, que ya viaja al navegador) y
 * no devuelve ningún secreto: sólo una lista de booleanos.
 */

export type Proveedor = "google" | "apple";

/*
 * Ante la duda, ningún botón.
 *
 * Si la consulta falla —red caída, Supabase lento— es preferible una pantalla
 * con correo y contraseña que un botón que probablemente no funcione. Entrar
 * con contraseña sigue estando siempre.
 */
export async function proveedoresHabilitados(): Promise<Proveedor[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !clave) return [];

  try {
    const respuesta = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: clave },
      cache: "no-store",
    });

    if (!respuesta.ok) return [];

    const datos = (await respuesta.json()) as { external?: Record<string, boolean> };
    const externos = datos.external ?? {};

    return (["google", "apple"] as Proveedor[]).filter((p) => externos[p] === true);
  } catch {
    return [];
  }
}

/** El nombre como lo escribe cada marca, para el texto del botón. */
export const NOMBRE_PROVEEDOR: Record<Proveedor, string> = {
  google: "Google",
  apple: "Apple",
};
