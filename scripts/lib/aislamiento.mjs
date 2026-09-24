/**
 * La prueba de aislamiento A/B, lista para mandar por la Management API.
 *
 * `supabase/pruebas/aislamiento_rls_e2e.sql` termina en `select ...; rollback;`.
 * Con psql se ven las filas; por la API (y `supabase db query --linked`, que usa
 * la misma API) se devuelve el resultado de la ÚLTIMA sentencia, que es el
 * rollback: nada. `npm run go` terminaba en "Unexpected end of JSON input"
 * (24/09/2026, contra producción).
 *
 * Acá el cierre se reemplaza por un bloque que junta las filas en JSON y
 * aborta la transacción con ellas en el mensaje de error. Abortar deshace todo
 * igual que el rollback —pase lo que pase con el cliente, no queda nada
 * escrito— y el resultado viaja en el único lugar que sobrevive: el error.
 */

export const MARCA_INICIO = "EOS_AISLAMIENTO_RESULTADO";
export const MARCA_FIN = "EOS_AISLAMIENTO_FIN";

const CIERRE = /select\s+prueba\s*,\s*ok\s+from\s+resultado\s*;\s*rollback\s*;\s*$/i;

export function sqlParaApi(texto) {
  const sql = String(texto).replace(/\r\n/g, "\n");
  if (!CIERRE.test(sql)) {
    throw new Error("la prueba de aislamiento cambió: no termina en `select prueba, ok from resultado; rollback;`");
  }
  return sql.replace(
    CIERRE,
    [
      "do $eos_resultado$",
      "begin",
      "  raise exception '%', format('" + MARCA_INICIO + "%s" + MARCA_FIN + "',",
      "    (select coalesce(json_agg(json_build_object('prueba', prueba, 'ok', ok)), '[]'::json) from resultado));",
      "end $eos_resultado$;",
      "",
    ].join("\n"),
  );
}

/** Todos los textos de una respuesta, esté el error en `message`, `error` o donde sea. */
function textos(valor, salida = []) {
  if (typeof valor === "string") salida.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => textos(v, salida));
  else if (valor && typeof valor === "object") Object.values(valor).forEach((v) => textos(v, salida));
  return salida;
}

/** Las filas que vienen dentro del error. `null` si el error es otro. */
export function filasDelError(texto) {
  const crudo = String(texto ?? "");
  let candidatos = [crudo];
  try {
    candidatos = [...textos(JSON.parse(crudo)), crudo];
  } catch {
    // No era JSON: se busca en el texto tal cual.
  }
  for (const mensaje of candidatos) {
    const i = mensaje.indexOf(MARCA_INICIO);
    const f = mensaje.indexOf(MARCA_FIN, i);
    if (i < 0 || f < 0) continue;
    try {
      const filas = JSON.parse(mensaje.slice(i + MARCA_INICIO.length, f));
      if (Array.isArray(filas)) return filas;
    } catch {
      // Sigue con el próximo texto.
    }
  }
  return null;
}
