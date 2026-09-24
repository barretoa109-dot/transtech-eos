import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MARCA_FIN, MARCA_INICIO, filasDelError, sqlParaApi } from "../../scripts/lib/aislamiento.mjs";

/**
 * `npm run go` contra producción (24/09/2026): "Aislamiento entre cuentas —
 * Unexpected end of JSON input". La prueba termina en ROLLBACK y la API solo
 * devuelve la última sentencia. Las filas ahora vuelven dentro del error.
 */

const PRUEBA = readFileSync(new URL("../../supabase/pruebas/aislamiento_rls_e2e.sql", import.meta.url), "utf8");

test("el cierre se cambia por un bloque que aborta con las filas; ya no hay rollback suelto", () => {
  const sql = sqlParaApi(PRUEBA);
  assert.ok(!/rollback\s*;\s*$/i.test(sql));
  assert.ok(sql.trimEnd().endsWith("end $eos_resultado$;"));
  assert.ok(sql.includes("raise exception"));
  assert.ok(sql.startsWith(PRUEBA.slice(0, PRUEBA.indexOf("select prueba, ok from resultado;"))));
});

test("funciona con el archivo en CRLF (checkout de Windows)", () => {
  assert.equal(sqlParaApi(PRUEBA.replace(/\n/g, "\r\n")), sqlParaApi(PRUEBA));
});

test("si la prueba cambia de forma, falla fuerte en vez de correr algo distinto", () => {
  assert.throws(() => sqlParaApi("begin; select 1; commit;"), /cambió/);
});

const FILAS = [
  { prueba: "B no ve mensajes de A", ok: true },
  { prueba: "anon no puede leer usuarios", ok: false },
];
const MENSAJE = `ERROR:  P0001: ${MARCA_INICIO}${JSON.stringify(FILAS)}${MARCA_FIN}\nCONTEXT:  PL/pgSQL function inline_code_block line 3 at RAISE`;

test("lee las filas del error, venga como venga el cuerpo", () => {
  assert.deepEqual(filasDelError(JSON.stringify({ message: `Failed to run sql query: ${MENSAJE}` })), FILAS);
  assert.deepEqual(filasDelError(JSON.stringify({ error: { detalle: [MENSAJE] } })), FILAS);
  assert.deepEqual(filasDelError(MENSAJE), FILAS);
});

test("otro error no se confunde con un resultado", () => {
  assert.equal(filasDelError(JSON.stringify({ message: "permission denied for table usuarios" })), null);
  assert.equal(filasDelError(""), null);
  assert.equal(filasDelError(`${MARCA_INICIO}no es json${MARCA_FIN}`), null);
});
