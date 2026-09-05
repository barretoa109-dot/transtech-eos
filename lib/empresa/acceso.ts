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
 * Ninguna fila tiene este id. Es la forma de decir "no devuelvas nada" en un
 * filtro que tiene que ser una expresión válida igual.
 */
const NADA = "00000000-0000-0000-0000-000000000000";

/**
 * El filtro que va en una consulta de tabla de negocio.
 *
 * ============================================================
 * SOLO POR EMPRESA, DESDE LA ETAPA 4 (v119)
 * ============================================================
 *
 * Hasta la v119 devolvía las dos condiciones, igual que las policies: era la
 * red mientras `empresa_id` se rellenaba. Ahora las policies quedaron solo con
 * `empresa_id`, y esto tiene que decir lo mismo.
 *
 * No es una preferencia de estilo. Estas rutas usan `adminSinTipos()`, que
 * **no pasa por RLS**: este filtro es la única frontera que tienen. Si dijera
 * algo más permisivo que las policies, las mismas filas se verían o no según
 * qué ruta las pidiera, y esa clase de diferencia no se descubre mirando la
 * pantalla.
 *
 * En la práctica no cambia qué se devuelve: se comprobó contra producción que
 * `eos_empresa_discrepancias_v111()` da cero en las ocho tablas, así que las
 * filas cuyo `usuario_id` coincide son exactamente las de su empresa.
 *
 * ============================================================
 * SIN EMPRESA NO SE DEVUELVE NADA
 * ============================================================
 *
 * Antes, sin empresa se caía a `usuario_id` y la persona igual veía lo suyo.
 * Eso ahora sería MÁS permisivo que la RLS, que no le mostraría nada. Falla
 * cerrado: si la empresa no se puede resolver hay un problema que hay que
 * arreglar —`eos_empresa_sin_activa_v118()` lo encuentra— y taparlo con un
 * acceso más ancho es la peor forma de no enterarse.
 *
 * Postgrest no permite un OR entre columnas con `.eq()` encadenados, así que
 * se arma la expresión textual que entiende `.or()`.
 */
export function filtroDeEmpresa(_usuarioId: string, empresaId: string | null): string {
  return `empresa_id.eq.${empresaId ?? NADA}`;
}
