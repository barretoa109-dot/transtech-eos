import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * De qué empresa son los datos que una ruta puede tocar.
 *
 * ============================================================
 * POR QUÉ UNA FUNCIÓN Y NO UN `eq("empresa_id", ...)` EN CADA RUTA
 * ============================================================
 *
 * Son 59 rutas filtrando por `usuario_id` con `adminSinTipos()`, que usa
 * `service_role` y NO pasa por RLS. Eso significa que el filtro de cada ruta
 * ES la seguridad: una que se olvide de filtrar devuelve datos de otro, y
 * ninguna policy lo va a impedir.
 *
 * Con la regla acá, el día que cambie —un usuario en varias empresas, una
 * empresa seleccionada desde la interfaz— cambia en un archivo en vez de en
 * cincuenta y nueve. Y `grep empresaDe` da la lista completa de quién la usa,
 * igual que `grep adminSinTipos` da la de quién saltea los tipos.
 *
 * ============================================================
 * FALLA CERRADO
 * ============================================================
 *
 * Si la empresa no se puede resolver, devuelve `null` y quien llama TIENE que
 * cortar. Nunca devuelve un valor de relleno: un filtro con una empresa
 * inventada no devuelve menos datos, devuelve los equivocados.
 */

/** La empresa principal del usuario, o null si no se pudo resolver. */
export async function empresaDe(
  admin: ClienteSinTipos,
  usuarioId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("eos_empresa_de_v109", { p_usuario_id: usuarioId });

  if (error) {
    console.error("Empresa: no se pudo resolver la del usuario:", error);
    return null;
  }

  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * La empresa del usuario de la SESIÓN, con el cliente de sesión.
 *
 * Para las rutas que no usan `adminSinTipos()`: ahí la RLS sí está activa y
 * `eos_mi_empresa_v109()` resuelve sola quién pregunta, sin que la ruta tenga
 * que pasarle un id. Es la versión más segura de las dos, porque no hay forma
 * de que la ruta pida la empresa de otro por error.
 */
export async function miEmpresa(supabase: ClienteSinTipos): Promise<string | null> {
  const { data, error } = await supabase.rpc("eos_mi_empresa_v109");

  if (error) {
    console.error("Empresa: no se pudo resolver la de la sesión:", error);
    return null;
  }

  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * El filtro que va en una consulta de tabla de negocio.
 *
 * Devuelve las DOS condiciones mientras dure la transición, por la misma razón
 * que las policies de la v111 usan un OR: `empresa_id` está rellenado hoy, pero
 * filtrar solo por él haría desaparecer de la pantalla —sin ningún error— una
 * fila que lo tuviera en null.
 *
 * Postgrest no permite un OR entre columnas con `.eq()` encadenados, así que se
 * arma la expresión textual que entiende `.or()`.
 */
export function filtroDeEmpresa(usuarioId: string, empresaId: string | null): string {
  return empresaId === null
    ? `usuario_id.eq.${usuarioId}`
    : `usuario_id.eq.${usuarioId},empresa_id.eq.${empresaId}`;
}
